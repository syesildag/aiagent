import * as os from 'os';
import * as path from 'path';
import { Options } from 'ollama';
import { GeneralAgent } from './agents/generalAgent';
import { WeatherAgent } from './agents/weatherAgent';
import { FileBasedAgent } from './agents/fileBasedAgent';
import { createLLMProvider, getLLMModel } from './mcp/llmFactory';
import { MCPServerManager, SubAgentRunner, ImageGenerationResult, MixedContentResult } from './mcp/mcpManager';
import { ToolApprovalCallback } from './mcp/approvalManager';
import { AiAgentSession } from './entities/ai-agent-session';
import { config } from './utils/config';
import Logger from './utils/logger';
import { loadAgentDefinitions } from './utils/agentLoader';

export type AgentName = string;

export interface Agent {
   setSession(session: AiAgentSession): void;
   chat(
     prompt: string,
     abortSignal?: AbortSignal,
     stream?: boolean,
     attachments?: { base64: string; mimeType: string; name?: string }[],
     approvalCallback?: ToolApprovalCallback,
     toolNameFilter?: string[],
     maxIterations?: number,
     freshContext?: boolean,
     onContextUpdate?: (used: number, max: number) => void,
     onCompact?: () => void,
   ): Promise<ReadableStream<string> | string | ImageGenerationResult | MixedContentResult>;
   getSystemPrompt(): string;
   getName(): AgentName;
   /** One-sentence description shown to the orchestrator LLM in the Task tool. */
   getDescription(): string;
   getOptions(): Partial<Options> | undefined;
   setMCPManager(manager: MCPServerManager): void;
   getAllowedServerNames(): string[] | undefined;
   addAssistantMessageToHistory(content: string | undefined): void;
   compactHistory(): Promise<string>;
}

const Agents: Record<string, Agent> = {};
let initialized = false;
let globalMCPManager: MCPServerManager | null = null;

export async function initializeAgents(): Promise<Record<AgentName, Agent>> {
   if (initialized) {
      return Agents;
   }

   // Shutdown existing MCP manager if it exists
   if (globalMCPManager) {
      await shutdownAgentSystem();
   }

   // Initialize global MCP manager
   const llmProvider = await createLLMProvider();
   const model = getLLMModel();
   globalMCPManager = new MCPServerManager(config.MCP_SERVERS_PATH, llmProvider, model);
   
   try {
      await globalMCPManager.ensureInitialized();
      Logger.info('Global MCP manager initialized successfully');
   } catch (error) {
      Logger.error(`Failed to initialize global MCP manager: ${error}`);
   }

   [
      new GeneralAgent(),
      new WeatherAgent(),
   ]
   .forEach(agent => {
      Agents[agent.getName()] = agent;
      // Set the global MCP manager for all agents
      agent.setMCPManager(globalMCPManager);
   });

   // Build the sub-agent runner and register it with the MCP manager.
   // This is done after all agents are created to avoid circular initialization.
   // Sub-agents always run without streaming and with freshContext so they
   // don't share or pollute the parent conversation history.
   // Only file-based agents are exposed as sub-agents (populated below after
   // scanning .claude/agents/ directories).
   const subAgentDescriptions: Record<string, string> = {};

   const subAgentRunner: SubAgentRunner = async (agentName, prompt, abortSignal) => {
      const subAgent = Agents[agentName];
      if (!subAgent) {
         throw new Error(`Unknown sub-agent: "${agentName}". Available: ${Object.keys(Agents).join(', ')}`);
      }
      const result = await subAgent.chat(
         prompt,
         abortSignal,
         false,       // no streaming — we need the full string result
         undefined,   // no attachments
         undefined,   // no approval callback for sub-agents
         undefined,   // no tool filter
         undefined,   // use default max iterations
         true,        // freshContext — isolated from parent history
      );
      return typeof result === 'string' ? result : '';
   };

   // Load file-based agents from ~/.claude/agents/ (user-level) and
   // .claude/agents/ (project-level). Project-level wins on name collision.
   const userAgentsDir    = path.resolve(os.homedir(),  '.claude', 'agents');
   const projectAgentsDir = path.resolve(process.cwd(), '.claude', 'agents');

   for (const agentsDir of [userAgentsDir, projectAgentsDir]) {
      for (const def of loadAgentDefinitions(agentsDir).values()) {
         const fileAgent = new FileBasedAgent(def);
         fileAgent.setMCPManager(globalMCPManager);
         if (Agents[def.name]) {
            Logger.info(`[Agents] File-based agent "${def.name}" from ${def.filePath} overrides the existing definition`);
         } else {
            Logger.info(`[Agents] Loaded file-based agent "${def.name}" from ${def.filePath}`);
         }
         Agents[def.name] = fileAgent;
         subAgentDescriptions[def.name] = fileAgent.getDescription();
      }
   }

   globalMCPManager.setSubAgentRunner(subAgentRunner, subAgentDescriptions);

   initialized = true;
   
   Logger.info(`Initialized ${Object.keys(Agents).length} agents: ${Object.keys(Agents).join(', ')}`);
   
   return Agents;
}

export async function getAgentFromName(agentName: string): Promise<Agent> {
   if (!initialized) {
      await initializeAgents();
   }
   
   const agent = Agents[agentName];
   if (!agent) {
      const availableAgents = Object.keys(Agents);
      throw new Error(`Invalid agent selected: ${agentName}. Available agents: ${availableAgents.join(', ')}`);
   }
   return agent;
}

export async function getAvailableAgentNames(): Promise<string[]> {
   if (!initialized) {
      await initializeAgents();
   }
   return Object.keys(Agents);
}

export function getGlobalMCPManager(): MCPServerManager | null {
   return globalMCPManager;
}

export async function shutdownAgentSystem(): Promise<void> {
   if (globalMCPManager) {
      try {
         await globalMCPManager.stopAllServers();
         Logger.info('MCP servers shut down successfully');
      } catch (error) {
         Logger.error(`Error shutting down MCP servers: ${error}`);
      }
      globalMCPManager = null;
   }
   initialized = false;
}