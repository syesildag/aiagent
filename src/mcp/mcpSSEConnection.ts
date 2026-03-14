import { EventEmitter } from 'events';
import Logger from '../utils/logger.js';
import type { MCPServer, MCPTool, MCPResource, MCPPrompt } from './mcpManager.js';

// ---------------------------------------------------------------------------
// Local type definitions (mirrors the private types in mcpManager.ts)
// ---------------------------------------------------------------------------

interface MCPServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
}

interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// MCPSSEConnection
//
// Drop-in replacement for MCPServerConnection when the MCP server uses the
// HTTP SSE transport instead of stdio.
//
// MCP SSE protocol (spec 2024-11-05):
//   1. GET  {httpUrl}/sse            — long-lived SSE event stream
//   2. Server sends:  event: endpoint\ndata: <postPath>\n\n
//   3. Client POSTs JSON-RPC to:    {origin}<postPath>
//   4. Server sends:  event: message\ndata: {json-rpc response}\n\n
// ---------------------------------------------------------------------------

export class MCPSSEConnection extends EventEmitter {
  private sseAbort: AbortController | null = null;
  private messageEndpointUrl: string | null = null;
  private requestId = 1;
  private pendingRequests = new Map<
    string | number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private capabilities: MCPServerCapabilities = {};
  private tools: MCPTool[] = [];
  private resources: MCPResource[] = [];
  private prompts: MCPPrompt[] = [];
  private running = false;

  constructor(private server: MCPServer) {
    super();
  }

  // ── Public interface (mirrors MCPServerConnection) ──────────────────────

  async start(): Promise<void> {
    const httpUrl = this.server.httpUrl;
    if (!httpUrl) {
      throw new Error(`[${this.server.name}] httpUrl is required for SSE protocol`);
    }

    this.sseAbort = new AbortController();

    // Wait until we receive the endpoint event before resolving.
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`[${this.server.name}] Timed out waiting for SSE endpoint event`));
      }, REQUEST_TIMEOUT_MS);

      this.connectSSE(httpUrl, resolve, reject, timeoutId);
    });

    await this.initialize();
    this.running = true;
    Logger.info(`[${this.server.name}] SSE connection established`);
  }

  stop(): void {
    this.running = false;
    this.sseAbort?.abort();
    this.sseAbort = null;
    this.messageEndpointUrl = null;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error(`[${this.server.name}] Connection closed`));
      this.pendingRequests.delete(id);
    }

    this.emit('exit', 0);
    Logger.info(`[${this.server.name}] SSE connection closed`);
  }

  isRunning(): boolean {
    return this.running;
  }

  async callTool(name: string, arguments_: unknown): Promise<unknown> {
    try {
      return await this.sendRequest('tools/call', { name, arguments: arguments_ });
    } catch (error) {
      Logger.error(`[${this.server.name}] Tool call error: ${error}`);
      throw error;
    }
  }

  async getResource(uri: string): Promise<unknown> {
    try {
      return await this.sendRequest('resources/read', { uri });
    } catch (error) {
      Logger.error(`[${this.server.name}] Resource read error: ${error}`);
      throw error;
    }
  }

  async getPrompt(name: string, arguments_?: unknown): Promise<unknown> {
    try {
      return await this.sendRequest('prompts/get', { name, arguments: arguments_ });
    } catch (error) {
      Logger.error(`[${this.server.name}] Prompt get error: ${error}`);
      throw error;
    }
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  getResources(): MCPResource[] {
    return this.resources;
  }

  getPrompts(): MCPPrompt[] {
    return this.prompts;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /**
   * Open the SSE stream and pump events into handleResponse / resolveEndpoint.
   * This is fire-and-forget after the initial endpoint negotiation resolves.
   */
  private connectSSE(
    httpUrl: string,
    onEndpoint: () => void,
    onError: (e: Error) => void,
    endpointTimeout: NodeJS.Timeout,
  ): void {
    const sseUrl = `${httpUrl}/sse`;

    fetch(sseUrl, {
      headers: { Accept: 'text/event-stream' },
      signal: this.sseAbort!.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`SSE connect failed: HTTP ${response.status}`);
        }
        if (!response.body) {
          throw new Error('SSE response has no body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = '';
        let currentEventType = '';
        let currentData = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE format: split on double newlines for event boundaries
          const rawLines = buffer.split('\n');
          buffer = rawLines.pop() ?? '';

          for (const rawLine of rawLines) {
            const line = rawLine.trimEnd();

            if (line === '') {
              // Empty line = dispatch the event
              if (currentEventType || currentData) {
                this.dispatchSSEEvent(
                  currentEventType,
                  currentData,
                  httpUrl,
                  onEndpoint,
                  endpointTimeout,
                );
                currentEventType = '';
                currentData = '';
              }
            } else if (line.startsWith('event:')) {
              currentEventType = line.slice('event:'.length).trim();
            } else if (line.startsWith('data:')) {
              currentData = line.slice('data:'.length).trim();
            }
            // Ignore id:, retry: fields
          }
        }

        Logger.info(`[${this.server.name}] SSE stream ended`);
        this.running = false;
        this.emit('exit', 0);
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return; // intentional stop()
        Logger.error(`[${this.server.name}] SSE error: ${err.message}`);
        // If we haven't resolved the endpoint yet, reject the start() promise
        clearTimeout(endpointTimeout);
        onError(err);
        this.running = false;
        this.emit('exit', 1);
      });
  }

  private dispatchSSEEvent(
    eventType: string,
    data: string,
    httpUrl: string,
    onEndpoint: () => void,
    endpointTimeout: NodeJS.Timeout,
  ): void {
    if (eventType === 'endpoint') {
      // data is the relative or absolute POST path, e.g. "/mcp/?sessionId=abc"
      clearTimeout(endpointTimeout);
      try {
        const base = new URL(httpUrl);
        // If data is a relative path, resolve against the origin
        this.messageEndpointUrl = data.startsWith('http')
          ? data
          : `${base.protocol}//${base.host}${data}`;
        Logger.info(`[${this.server.name}] MCP POST endpoint: ${this.messageEndpointUrl}`);
        onEndpoint();
      } catch (e) {
        Logger.error(`[${this.server.name}] Failed to parse endpoint URL: ${data}`);
        onEndpoint(); // still resolve so initialize() can attempt
      }
      return;
    }

    if (eventType === 'message' || eventType === '') {
      if (!data) return;
      try {
        const msg = JSON.parse(data) as MCPResponse;
        if (msg.id !== undefined) {
          this.handleResponse(msg);
        }
      } catch {
        Logger.error(`[${this.server.name}] Failed to parse SSE message: ${data}`);
      }
    }
  }

  private handleResponse(response: MCPResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      this.pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(new Error(`MCP Error: ${response.error.message}`));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private sendRequest(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.messageEndpointUrl) {
        reject(new Error(`[${this.server.name}] Not connected — no message endpoint`));
        return;
      }

      const id = this.requestId++;
      const request: MCPRequest = { jsonrpc: '2.0', id, method, params };

      this.pendingRequests.set(id, { resolve, reject });

      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout for method: ${method}`));
        }
      }, REQUEST_TIMEOUT_MS);

      fetch(this.messageEndpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
        .then((res) => {
          if (!res.ok) {
            clearTimeout(timeoutId);
            this.pendingRequests.delete(id);
            reject(new Error(`POST failed: HTTP ${res.status}`));
          }
          // Response will arrive as an SSE 'message' event — don't read body here
        })
        .catch((err: Error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(id);
          reject(err);
        });
    });
  }

  private async sendNotification(method: string, params?: unknown): Promise<void> {
    if (!this.messageEndpointUrl) return;

    const notification = { jsonrpc: '2.0' as const, method, params };
    await fetch(this.messageEndpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    }).catch((err: Error) =>
      Logger.warn(`[${this.server.name}] Notification send failed: ${err.message}`)
    );
  }

  private async initialize(): Promise<void> {
    const initResponse = (await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {}, resources: {}, prompts: {} },
      clientInfo: { name: 'mcp-ai-agent', version: '1.0.0' },
    })) as { capabilities?: MCPServerCapabilities };

    this.capabilities = initResponse?.capabilities ?? {};

    await this.sendNotification('notifications/initialized', {});
    await this.refreshCapabilities();
  }

  private async refreshCapabilities(): Promise<void> {
    try {
      if (this.capabilities.tools) {
        const r = (await this.sendRequest('tools/list', {})) as { tools?: MCPTool[] };
        this.tools = r?.tools ?? [];
      }
      if (this.capabilities.resources) {
        const r = (await this.sendRequest('resources/list', {})) as {
          resources?: MCPResource[];
        };
        this.resources = r?.resources ?? [];
      }
      if (this.capabilities.prompts) {
        const r = (await this.sendRequest('prompts/list', {})) as { prompts?: MCPPrompt[] };
        this.prompts = r?.prompts ?? [];
      }
      Logger.info(
        `[${this.server.name}] Capabilities: tools=${this.tools.length}, ` +
          `resources=${this.resources.length}, prompts=${this.prompts.length}`
      );
    } catch (error) {
      Logger.error(`[${this.server.name}] Error refreshing capabilities: ${error}`);
    }
  }
}
