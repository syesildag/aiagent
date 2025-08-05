import { McpServerInstance } from './types';
import { McpServerError } from './errors';
import Logger from '../utils/logger';

export class McpToolExecutor {
   constructor(private serverInstance: McpServerInstance) {}

   async executeTool(toolName: string, parameters: any): Promise<string> {
      if (!this.serverInstance.isRunning) {
         throw new McpServerError(`MCP server '${this.serverInstance.name}' is not running`);
      }

      try {
         if (this.serverInstance.config.type === 'local') {
            return await this.executeLocalTool(toolName, parameters);
         } else {
            return await this.executeRemoteTool(toolName, parameters);
         }
      } catch (error) {
         throw new McpServerError(`Failed to execute tool '${toolName}' on server '${this.serverInstance.name}': ${error instanceof Error ? error.message : String(error)}`);
      }
   }

   private async executeLocalTool(toolName: string, parameters: any): Promise<string> {
      if (!this.serverInstance.process) {
         throw new Error('Local server process not available');
      }

      return new Promise((resolve, reject) => {
         const request = {
            id: Date.now(),
            method: 'tools/call',
            params: {
               name: toolName,
               arguments: parameters
            }
         };

         let responseData = '';
         let errorData = '';
         
         const timeout = setTimeout(() => {
            reject(new Error('Tool execution timeout'));
         }, 30000); // 30 second timeout

         const onData = (data: Buffer) => {
            responseData += data.toString();
            try {
               const response = JSON.parse(responseData);
               if (response.id === request.id) {
                  clearTimeout(timeout);
                  this.serverInstance.process?.stdout?.off('data', onData);
                  this.serverInstance.process?.stderr?.off('data', onError);
                  
                  if (response.error) {
                     reject(new Error(response.error.message || 'Tool execution error'));
                  } else {
                     resolve(response.result || '');
                  }
               }
            } catch {
               // Continue accumulating data
            }
         };

         const onError = (data: Buffer) => {
            errorData += data.toString();
         };

         this.serverInstance.process.stdout?.on('data', onData);
         this.serverInstance.process.stderr?.on('data', onError);

         // Send the request
         this.serverInstance.process.stdin?.write(JSON.stringify(request) + '\n');

         Logger.debug(`Sent MCP tool request: ${JSON.stringify(request)}`);
      });
   }

   private async executeRemoteTool(toolName: string, parameters: any): Promise<string> {
      if (!this.serverInstance.connection) {
         throw new Error('Remote server connection not available');
      }

      const requestBody = {
         method: 'tools/call',
         params: {
            name: toolName,
            arguments: parameters
         }
      };

      const response = await fetch(`${this.serverInstance.connection.url}/tools/call`, {
         method: 'POST',
         headers: {
            'Content-Type': 'application/json',
            ...this.serverInstance.connection.headers
         },
         body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return result.result || '';
   }

   getAvailableTools(): string[] {
      return this.serverInstance.tools?.map(tool => tool.name) || [];
   }
}