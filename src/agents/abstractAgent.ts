import { Options } from "ollama";
import { Agent, AgentName } from "../agent";
import { MCPServerManager } from "../mcp/mcpManager";
import { ToolApprovalCallback } from "../mcp/approvalManager";
import { AiAgentSession } from "../entities/ai-agent-session";
import Logger from "../utils/logger";

export default abstract class AbstractAgent implements Agent {

   private session?: AiAgentSession;
   private mcpManager?: MCPServerManager | null;

   constructor() {
      // MCP manager will be set externally for better lifecycle management
   }

   setMCPManager(manager: MCPServerManager | null): void {
      this.mcpManager = manager;
   }

   abstract getSystemPrompt(): string;

   abstract getName(): AgentName;

   setSession(session: AiAgentSession) {
      this.session = session;
   }

   getSession(): AiAgentSession | undefined {
      return this.session;
   }

   getOptions(): Partial<Options> {
      return {
         seed: 123,
         temperature: 0,
      };
   }

   shouldValidate(): boolean {
      return false;
   }

   async validate(_data?: any): Promise<boolean> {
      return false;
   }

   getAllowedServerNames(): string[] | undefined {
      return undefined; // Default implementation - use all servers
   }

   addAssistantMessageToHistory(finalContent: string | undefined) {

      if (!this.mcpManager) {
         return;
      }

     return this.mcpManager.addAssistantMessageToHistory(finalContent);
   }

   async chat(
     prompt: string,
     abortSignal?: AbortSignal,
     stream?: boolean,
     imageData?: { base64: string; mimeType: string },
     approvalCallback?: ToolApprovalCallback,
   ): Promise<ReadableStream<string> | string> {
      if (!this.mcpManager) {
         throw new Error('MCP manager not initialized');
      }

      // Use MCP system for enhanced capabilities
      try {
         const systemPrompt = this.getSystemPrompt();
         const serverNames = this.getAllowedServerNames();
         const userLogin = this.session?.getUserLogin();
         return await this.mcpManager.chatWithLLM({
            message: prompt,
            customSystemPrompt: systemPrompt,
            abortSignal,
            serverNames,
            stream,
            imageData,
            userLogin,
            approvalCallback,
         });
      } catch (error) {
         Logger.error(`MCP chat failed: ${error instanceof Error ? error.message : String(error)}`);
         throw error;
      }
   }

   // Helper method for agents to get available tools for specific servers
   getAvailableTools(serverNames?: string[]): string[] {
      if (!this.mcpManager) {
         return [];
      }

      // Use provided serverNames, or fall back to agent's own server names, or use all
      const targetServers = serverNames || this.getAllowedServerNames();
      
      if (targetServers && targetServers.length > 0) {
         const tools = this.mcpManager.getToolsForServers(targetServers);
         return tools.map(tool => tool.function.name);
      } else {
         const toolsByServer = this.mcpManager.getToolsByServer();
         return Object.values(toolsByServer).flat().map(tool => tool.function.name);
      }
   }

   // Helper method to get available server names
   getAvailableServerNames(): string[] {
      if (!this.mcpManager) {
         return [];
      }
      return this.mcpManager.getAvailableServerNames();
   }
}