import { Options } from "ollama";
import { Agent, AgentName } from "../agent";
import { MCPServerManager, ImageGenerationResult, MixedContentResult } from "../mcp/mcpManager";
import { ToolApprovalCallback } from "../mcp/approvalManager";
import { AiAgentSession } from "../entities/ai-agent-session";
import aiagentuserRepository from "../entities/ai-agent-user";
import Logger from "../utils/logger";
import { slashCommandRegistry } from "../utils/slashCommandRegistry";
import { getEmbeddingService } from "../utils/embeddingService";
import { config } from "../utils/config";

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
    * Uses cached tool descriptions (the same data shown by /mcp-status) rather
    * than the coarse server-level description in mcp-servers.json. For each
    * server the maximum similarity across all its tools is used. Servers with
    * no cached tools yet are always included. Falls back to the full candidate
    * list if the embedding service is unavailable or no servers have cached tools.
    */
   private async filterServersByPromptSimilarity(
      prompt: string,
      allowed: string[] | undefined,
      threshold = config.EMBEDDING_SIMILARITY_THRESHOLD,
   ): Promise<string[] | undefined> {
      if (!this.mcpManager) return allowed;

      const configs = this.mcpManager.getEnabledServerConfigs();
      const candidates = allowed
         ? configs.filter(s => allowed.includes(s.name))
         : configs;

      const toolsByServer = this.mcpManager.getToolsByServer();

      // Servers not yet in the tools cache are always included (not yet started)
      const noTools = candidates.filter(s => !toolsByServer[s.name] || toolsByServer[s.name].length === 0).map(s => s.name);
      const withTools = candidates.filter(s => toolsByServer[s.name]?.length > 0);

      if (withTools.length === 0) return allowed;

      try {
         const embeddingService = getEmbeddingService();

         // Build a flat list of tool descriptions and track which server each belongs to.
         // Strip the "[serverName] " prefix added for LLM attribution — it adds noise to embeddings
         // (e.g. "[outlook]" pulls the vector toward email semantics, hurting calendar matches).
         const toolEntries: { serverName: string; description: string }[] = [];
         for (const server of withTools) {
            for (const tool of toolsByServer[server.name]) {
               if (tool.function.description) {
                  const desc = tool.function.description.replace(/^\[[^\]]+\]\s*/, '');
                  toolEntries.push({ serverName: server.name, description: desc });
               }
            }
         }

         if (toolEntries.length === 0) return allowed;

         // Batch all texts so they use the same provider → consistent dimensions
         const texts = [prompt, ...toolEntries.map(e => e.description)];
         const embeddings = await embeddingService.generateBatchEmbeddings(texts);
         const promptEmbedding = embeddings[0];

         // Compute max similarity per server across all its tools
         const maxSimilarityByServer = new Map<string, number>();
         for (let i = 0; i < toolEntries.length; i++) {
            const { serverName } = toolEntries[i];
            const { similarity } = embeddingService.calculateSimilarity(promptEmbedding, embeddings[i + 1], 'cosine');
            const prev = maxSimilarityByServer.get(serverName) ?? 0;
            if (similarity > prev) maxSimilarityByServer.set(serverName, similarity);
         }

         const matched: string[] = [...noTools];
         for (const server of withTools) {
            const similarity = maxSimilarityByServer.get(server.name) ?? 0;
            Logger.debug(`[Servers] "${server.name}" max-tool-similarity=${similarity.toFixed(3)} threshold=${threshold}`);
            if (similarity >= threshold) {
               Logger.info(`[Servers] Loaded "${server.name}" (max-tool-similarity=${similarity.toFixed(3)})`);
               matched.push(server.name);
            }
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
         const { block: skillsBlock, maxIterations: skillsMaxIterations, allowedTools: skillAllowedTools } =
           await slashCommandRegistry.getSkillsSystemPromptBlockForPrompt(prompt);
         const baseSystemPrompt = this.getSystemPrompt();
         const systemPrompt = skillsBlock
           ? `${baseSystemPrompt}\n\n${skillsBlock}`
           : baseSystemPrompt;
         // Use the caller-supplied maxIterations (slash command) if present;
         // otherwise fall back to the highest value declared by matched skills.
         maxIterations = maxIterations ?? skillsMaxIterations;

         const effectivePrompt = `${systemPrompt}\n\n${prompt}`;
         const similarityServers = await this.filterServersByPromptSimilarity(effectivePrompt, this.getAllowedServerNames());
         // Force-include servers declared by matched skills' allowed-tools so
         // multi-step skills (e.g. forecast needing weather + time + outlook)
         // are always available regardless of similarity score.
         const serverNames = skillAllowedTools && skillAllowedTools.length > 0
           ? [...new Set([...(similarityServers ?? []), ...skillAllowedTools])]
           : similarityServers;
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