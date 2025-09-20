import { Options } from "ollama";
import { Agent, AgentName } from "../agent";
import { Session } from "../repository/entities/session";
import Logger from "../utils/logger";
import { queryDatabase } from "../utils/pgClient";
import { config } from "../utils/config";
import { MCPServerManager } from "../mcp/mcpManager";
import { createLLMProvider, getLLMModel } from "../mcp/llmFactory";

export default abstract class AbstractAgent implements Agent {

   private session?: Session;
   private mcpManager?: MCPServerManager;

   constructor() {
      // MCP manager will be set externally for better lifecycle management
   }

   setMCPManager(manager: MCPServerManager): void {
      this.mcpManager = manager;
   }

   async initializeMCP(): Promise<void> {
      // MCP initialization is now handled globally
      // This method is kept for backward compatibility
      if (!this.mcpManager) {
         Logger.warn('MCP manager not set, creating local instance');
         const llmProvider = createLLMProvider();
         const model = getLLMModel();
         this.mcpManager = new MCPServerManager(config.MCP_SERVERS_PATH, llmProvider, model);
         await this.mcpManager.loadServersConfig();
         await this.mcpManager.startAllServers();
      }
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
         await this.saveConversation(prompt, response);
         return response;
      } catch (error) {
         Logger.error(`MCP chat failed: ${error instanceof Error ? error.message : String(error)}`);
         throw error;
      }
   }

   async saveConversation(question: string, answer: string) {      const query = `
       INSERT INTO conversations (question, answer)
       VALUES ($1, $2)
       RETURNING id;
     `;

      const result = await queryDatabase(query, [question, answer]);

      return result[0]?.id;
   }
}