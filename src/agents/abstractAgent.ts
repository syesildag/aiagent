import { Options } from "ollama";
import { Agent, AgentName } from "../agent";
import { MCPServerManager } from "../mcp/mcpManager";
import { Session } from "../repository/entities/session";
import Logger from "../utils/logger";

export default abstract class AbstractAgent implements Agent {

   private session?: Session;
   private mcpManager?: MCPServerManager;

   constructor() {
      // MCP manager will be set externally for better lifecycle management
   }

   setMCPManager(manager: MCPServerManager): void {
      this.mcpManager = manager;
   }

   getSystemPrompt(): string | undefined {
      return undefined;
   }

   abstract getName(): AgentName;

   setSession(session: Session) {
      this.session = session;
   }

   getSession(): Session | undefined {
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

   async chat(prompt: string): Promise<string> {
      if (!this.mcpManager) {
         throw new Error('MCP manager not initialized');
      }

      // Use MCP system for enhanced capabilities
      try {
         const systemPrompt = this.getSystemPrompt();
         const response = await this.mcpManager.chatWithLLM(prompt, undefined, systemPrompt);
         return response;
      } catch (error) {
         Logger.error(`MCP chat failed: ${error instanceof Error ? error.message : String(error)}`);
         throw error;
      }
   }
}