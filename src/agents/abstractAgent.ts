import { Options } from "ollama";
import { Agent, AgentName } from "../agent";
import { MCPServerManager, ImageGenerationResult, MixedContentResult } from "../mcp/mcpManager";
import { ToolApprovalCallback } from "../mcp/approvalManager";
import { AiAgentSession } from "../entities/ai-agent-session";
import aiagentuserRepository from "../entities/ai-agent-user";
import Logger from "../utils/logger";
import { slashCommandRegistry } from "../utils/slashCommandRegistry";
import { getEmbeddingService } from "../utils/embeddingService";

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

   getDescription(): string {
      return `${this.getName()} agent`;
   }

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

   /**
    * Filters the candidate server list by semantic similarity to the prompt.
    * Servers with a description in mcp-servers.json are scored; those below
    * the threshold are excluded. Falls back to the full candidate list if the
    * embedding service is unavailable or no servers have descriptions.
    */
   private async filterServersByPromptSimilarity(
      prompt: string,
      allowed: string[] | undefined,
      threshold = 0.35,
   ): Promise<string[] | undefined> {
      if (!this.mcpManager) return allowed;

      const configs = this.mcpManager.getEnabledServerConfigs();
      const candidates = allowed
         ? configs.filter(s => allowed.includes(s.name))
         : configs;

      const withDesc = candidates.filter(s => s.description);
      if (withDesc.length === 0) return allowed;

      try {
         const embeddingService = getEmbeddingService();

         // Servers without a description are always included
         const noDesc = candidates.filter(s => !s.description).map(s => s.name);
         const withDesc = candidates.filter(s => s.description);

         // Batch all texts together so they use the same provider → consistent dimensions
         const texts = [prompt, ...withDesc.map(s => s.description as string)];
         const embeddings = await embeddingService.generateBatchEmbeddings(texts);
         const promptEmbedding = embeddings[0];
         const matched: string[] = [...noDesc];

         for (let i = 0; i < withDesc.length; i++) {
            const server = withDesc[i];
            const { similarity } = embeddingService.calculateSimilarity(promptEmbedding, embeddings[i + 1], 'cosine');
            Logger.debug(`[Servers] "${server.name}" similarity=${similarity.toFixed(3)} threshold=${threshold}`);
            if (similarity >= threshold) {
               Logger.info(`[Servers] Loaded "${server.name}" (similarity=${similarity.toFixed(3)})`);
               matched.push(server.name);
            }
         }

         // If nothing matched, fall back to full candidate list to avoid breaking the agent
         if (matched.length === 0) {
            Logger.debug('[Servers] No servers matched similarity threshold; using all candidates');
            return allowed;
         }

         return matched;
      } catch (error) {
         Logger.warn(`[Servers] Similarity filtering failed (${error instanceof Error ? error.message : String(error)}); using all candidates`);
         return allowed;
      }
   }

   /**
    * Override to use a different LLM model for this agent's calls.
    * File-based agents source this from the `model:` frontmatter field.
    * Returns undefined to use the globally configured model.
    */
   getModelOverride(): string | undefined {
      return undefined;
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
     attachments?: { base64: string; mimeType: string; name?: string }[],
     approvalCallback?: ToolApprovalCallback,
     toolNameFilter?: string[],
     maxIterations?: number,
     freshContext?: boolean,
     onContextUpdate?: (used: number, max: number) => void,
     onCompact?: (info: { summarized: number; kept: number; tokensBefore: number; tokensAfter: number }) => void,
     isAdmin?: boolean,
   ): Promise<ReadableStream<string> | string | ImageGenerationResult | MixedContentResult> {
      if (!this.mcpManager) {
         throw new Error('MCP manager not initialized');
      }

      try {
         // Initialize registry (no-op after first call) and inject all skills
         // into the system prompt so the LLM is always aware of them.
         slashCommandRegistry.initialize();
         const { block: skillsBlock, maxIterations: skillsMaxIterations } =
           await slashCommandRegistry.getSkillsSystemPromptBlockForPrompt(prompt);
         const baseSystemPrompt = this.getSystemPrompt();
         const systemPrompt = skillsBlock
           ? `${baseSystemPrompt}\n\n${skillsBlock}`
           : baseSystemPrompt;
         // Use the caller-supplied maxIterations (slash command) if present;
         // otherwise fall back to the highest value declared by matched skills.
         maxIterations = maxIterations ?? skillsMaxIterations;

         const effectivePrompt = `${systemPrompt}\n\n${prompt}`;
         const serverNames = await this.filterServersByPromptSimilarity(effectivePrompt, this.getAllowedServerNames());
         const userLogin = this.session?.getUserLogin();
         // If isAdmin was not provided by the caller (e.g. AgentJob), fall back to a DB
         // lookup from the stored session. When provided (web chat route), we trust the
         // caller's value, which was captured before any awaits that could race with
         // concurrent requests overwriting the singleton agent's session.
         if (isAdmin === undefined) {
            isAdmin = false;
            if (userLogin) {
               const user = await aiagentuserRepository.findByLogin(userLogin);
               isAdmin = user?.getIsAdmin() ?? false;
            }
         }
         return await this.mcpManager.chatWithLLM({
            message: prompt,
            customSystemPrompt: systemPrompt,
            abortSignal,
            serverNames,
            stream,
            attachments,
            userLogin,
            isAdmin,
            approvalCallback,
            toolNameFilter,
            maxIterations,
            freshContext,
            modelOverride: this.getModelOverride(),
            onContextUpdate,
            onCompact,
         });
      } catch (error) {
         Logger.error(`MCP chat failed: ${error instanceof Error ? error.message : String(error)}`);
         throw error;
      }
   }

   hasActiveConversation(): boolean {
      return this.mcpManager?.hasActiveConversation() ?? false;
   }

   async restoreConversationHistory(
      messages: Array<{ role: string; content: string }>,
      userId?: string,
   ): Promise<void> {
      if (!this.mcpManager) {
         throw new Error('MCP manager not initialized');
      }
      return this.mcpManager.restoreConversation(messages, userId);
   }

   async clearConversationHistory(): Promise<void> {
      await this.mcpManager?.clearConversationHistory();
   }

   getActiveDbConversationId(): number | null {
      return this.mcpManager?.getActiveDbConversationId() ?? null;
   }

   setActiveDbConversationId(id: number | null): void {
      this.mcpManager?.setActiveDbConversationId(id);
   }

   setCurrentConversationId(uuid: string): void {
      this.mcpManager?.setCurrentConversationId(uuid);
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