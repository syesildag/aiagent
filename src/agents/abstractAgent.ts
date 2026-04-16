import { Options } from "ollama";
import { Agent, AgentName } from "../agent";
import { AiAgentSession } from "../entities/ai-agent-session";
import aiagentuserRepository from "../entities/ai-agent-user";
import { ToolApprovalCallback } from "../mcp/approvalManager";
import { ImageGenerationResult, MCPServerManager, MixedContentResult, SUB_AGENT_RUNNER } from "../mcp/mcpManager";
import { BM25Index } from "../utils/bm25Index";
import { config } from "../utils/config";
import { getEmbeddingService } from "../utils/embeddingService";
import Logger from "../utils/logger";
import { slashCommandRegistry } from "../utils/slashCommandRegistry";

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
    * Builds a flat list of (serverName, description) entries from the tools cache,
    * stripping the "[serverName] " attribution prefix.
    */
   private buildToolEntries(withTools: { name: string }[], toolsByServer: Record<string, { function: { description?: string } }[]>) {
      const toolEntries: { serverName: string; description: string }[] = [];
      for (const server of withTools) {
         for (const tool of toolsByServer[server.name]) {
            if (tool.function.description) {
               const desc = tool.function.description.replace(/^\[[^\]]+\]\s*/, '');
               toolEntries.push({ serverName: server.name, description: desc });
            }
         }
      }
      return toolEntries;
   }

   /**
    * Partitions enabled servers into alwaysOn, noTools, withTools, and builds
    * their tool entries. Returns null when scoring should be skipped (no tools
    * available), signalling the caller to fall back to `allowed`.
    */
   private prepareServerFiltering(allowed: string[] | undefined): {
      alwaysOn: string[];
      noTools: string[];
      withTools: { name: string }[];
      toolEntries: { serverName: string; description: string }[];
   } | null {
      if (!this.mcpManager) return null;

      const configs = this.mcpManager.getEnabledServerConfigs();
      configs.push({ name: SUB_AGENT_RUNNER, enabled: true });
      const candidates = allowed
         ? configs.filter(s => allowed.includes(s.name))
         : configs;

      const toolsByServer = this.mcpManager.getToolsByServer();
      const alwaysOn = candidates.filter(s => s.alwaysInclude).map(s => s.name);
      const filterable = candidates.filter(s => !s.alwaysInclude);
      const noTools = filterable
         .filter(s => !toolsByServer[s.name] || toolsByServer[s.name].length === 0)
         .map(s => s.name);
      const withTools = filterable.filter(s => toolsByServer[s.name]?.length > 0);

      if (withTools.length === 0) return null;

      const toolEntries = this.buildToolEntries(withTools, toolsByServer);
      if (toolEntries.length === 0) return null;

      return { alwaysOn, noTools, withTools, toolEntries };
   }

   /**
    * Assembles the final server list from pre-scored results. Servers in alwaysOn
    * and noTools are unconditionally included; withTools servers are included only
    * when their best score meets the threshold.
    */
   private buildMatchedFromScores(
      alwaysOn: string[],
      noTools: string[],
      withTools: { name: string }[],
      maxScoreByServer: Map<string, number>,
      threshold: number,
      metricLabel: string,
   ): string[] {
      const matched: string[] = [...alwaysOn, ...noTools];
      for (const server of withTools) {
         const score = maxScoreByServer.get(server.name) ?? 0;
         Logger.debug(`[Servers] "${server.name}" max-tool-${metricLabel}=${score.toFixed(3)} threshold=${threshold}`);
         if (score >= threshold) {
            Logger.debug(`[Servers] Loaded "${server.name}" (max-tool-${metricLabel}=${score.toFixed(3)})`);
            matched.push(server.name);
         }
      }
      return matched;
   }

   /**
    * Filters the candidate server list using BM25 keyword scoring over cached
    * tool descriptions. No neural-inference calls — runs entirely in-process.
    */
   private filterServersByBM25(
      prompt: string,
      allowed: string[] | undefined,
      threshold = config.EMBEDDING_SIMILARITY_THRESHOLD,
   ): string[] | undefined {
      const partitions = this.prepareServerFiltering(allowed);
      if (!partitions) return allowed;

      const { alwaysOn, noTools, withTools, toolEntries } = partitions;

      const bm25 = new BM25Index(toolEntries.map(e => e.description));
      // Normalize by self-score: how well the query matches itself using the
      // corpus IDF weights. This gives an absolute [0,1] value independent of
      // which other documents happen to score highest in the current corpus.
      // Relative normalization (÷ global max) breaks when a catch-all description
      // (e.g. memory's search tool) matches a rare token in every query.
      const rawScores = bm25.scoreAll(prompt);
      const selfScore = bm25.scoreAgainstQuery(prompt, prompt);
      const norm = selfScore > 0 ? selfScore : Math.max(...rawScores, Number.EPSILON);
      const normalizedScores = rawScores.map(s => s / norm);

      const maxScoreByServer = new Map<string, number>();
      for (let i = 0; i < toolEntries.length; i++) {
         const { serverName } = toolEntries[i];
         const prev = maxScoreByServer.get(serverName) ?? 0;
         if (normalizedScores[i] > prev) maxScoreByServer.set(serverName, normalizedScores[i]);
      }

      Logger.debug(`BM25 raw scores: ${toolEntries.map((e, i) => `"${e.serverName}": ${rawScores[i].toFixed(3)}`).join(', ')}`);
      return this.buildMatchedFromScores(alwaysOn, noTools, withTools, maxScoreByServer, threshold, 'bm25');
   }

   /**
    * Dispatches to the appropriate server-filtering strategy based on
    * TOOL_ROUTING_STRATEGY config. Short prompts skip filtering entirely.
    */
   private async filterServers(
      prompt: string,
      allowed: string[] | undefined,
   ): Promise<string[] | undefined> {
      Logger.debug(`[Servers] Filtering servers for prompt: "${prompt}"`);
      const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount < config.EMBEDDING_MIN_PROMPT_WORDS) {
         Logger.debug(`[Servers] Prompt too short (${wordCount} words < ${config.EMBEDDING_MIN_PROMPT_WORDS}); skipping filter`);
         return allowed;
      }
      Logger.debug(`[Servers] Prompt has ${wordCount} words; applying filter strategy "${config.TOOL_ROUTING_STRATEGY}"`);
      if (config.TOOL_ROUTING_STRATEGY === 'none') return allowed;
      if (config.TOOL_ROUTING_STRATEGY === 'bm25') return this.filterServersByBM25(prompt, allowed);
      return this.filterServersByPromptSimilarity(prompt, allowed);
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
      const partitions = this.prepareServerFiltering(allowed);
      if (!partitions) return allowed;

      const { alwaysOn, noTools, withTools, toolEntries } = partitions;

      try {
         const embeddingService = getEmbeddingService();

         // Batch all texts so they use the same provider → consistent dimensions
         // Strip the "[serverName] " prefix added for LLM attribution — it adds noise to embeddings
         // (e.g. "[outlook]" pulls the vector toward email semantics, hurting calendar matches).
         Logger.debug(`Filtering servers by embedding similarity: prompt="${prompt}", tools=[${toolEntries.map(e => `"${e.serverName}": "${e.description}"`).join(', ')}], threshold=${threshold}`);
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

         Logger.debug(`Embedding similarities: ${toolEntries.map(e => `"${e.serverName}": ${maxSimilarityByServer.get(e.serverName)?.toFixed(3) ?? 'n/a'}`).join(', ')}`);
         return this.buildMatchedFromScores(alwaysOn, noTools, withTools, maxSimilarityByServer, threshold, 'similarity');
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

      Logger.debug(`[Agent] "${this.getName()}" received chat request: "${prompt}"`);
      try {
         // Initialize registry (no-op after first call) and inject all skills
         // into the system prompt so the LLM is always aware of them.
         slashCommandRegistry.initialize();
         Logger.debug(`[Agent] "${this.getName()}" system prompt before skills injection: "${this.getSystemPrompt()}"`);
         const { block: skillsBlock, maxIterations: skillsMaxIterations, allowedTools: skillAllowedTools } =
            await slashCommandRegistry.getSkillsSystemPromptBlockForPrompt(prompt);
         const baseSystemPrompt = this.getSystemPrompt();
         const systemPrompt = skillsBlock
            ? `${baseSystemPrompt}\n\n${skillsBlock}`
            : baseSystemPrompt;
         // Use the caller-supplied maxIterations (slash command) if present;
         // otherwise fall back to the highest value declared by matched skills.
         maxIterations = maxIterations ?? skillsMaxIterations;

         const similarityServers = await this.filterServers(prompt, this.getAllowedServerNames());
         // Force-include servers declared by matched skills' allowed-tools so
         // multi-step skills (e.g. forecast needing weather + time + outlook)
         // are always available regardless of similarity score.
         // Constrain to the agent's own allowed set to prevent privilege escalation.
         const agentAllowed = this.getAllowedServerNames();
         const filteredSkillTools = skillAllowedTools
            ? skillAllowedTools.filter(s => !agentAllowed || agentAllowed.includes(s))
            : undefined;
         const serverNames = filteredSkillTools && filteredSkillTools.length > 0
            ? [...new Set([...(similarityServers ?? []), ...filteredSkillTools])]
            : similarityServers;
         Logger.debug(`[Agent] "${this.getName()}" final server list after filtering and skill injection: ${serverNames ? serverNames.join(', ') : 'all'}`);
         const userLogin = this.session?.getUserLogin();
         Logger.debug(`[Agent] "${this.getName()}" user login: ${userLogin ?? '<<none>>'}`);
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
         Logger.debug(`[Agent] "${this.getName()}" system prompt: "${systemPrompt}"`);
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