import { Options } from "ollama";
import { Agent, AgentName } from "../agent";
import { AiAgentSession } from "../entities/ai-agent-session";
import aiagentuserRepository from "../entities/ai-agent-user";
import { ToolApprovalCallback } from "../mcp/approvalManager";
import { ImageGenerationResult, MCPServerManager, MixedContentResult } from "../mcp/mcpManager";
import Logger from "../utils/logger";
import { slashCommandRegistry } from "../utils/slashCommandRegistry";
import type { ServerFilter } from "../mcp/serverFilter";

export default abstract class AbstractAgent implements Agent {

   private session?: AiAgentSession;
   private mcpManager?: MCPServerManager | null;
   private serverFilter?: ServerFilter;

   constructor() {
      // MCP manager will be set externally for better lifecycle management
   }

   setMCPManager(manager: MCPServerManager | null): void {
      this.mcpManager = manager;
   }

   setServerFilter(sf: ServerFilter): void {
      this.serverFilter = sf;
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

   getExcludedServerNames(): string[] {
      return [];
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

         const similarityServers = await this.serverFilter?.filterServers(prompt, this.getAllowedServerNames())
            ?? this.getAllowedServerNames();
         // Force-include servers declared by matched skills' allowed-tools so
         // multi-step skills (e.g. forecast needing weather + time + outlook)
         // are always available regardless of similarity score.
         // Constrain to the agent's own allowed set to prevent privilege escalation.
         const agentAllowed = this.getAllowedServerNames();
         const filteredSkillTools = skillAllowedTools
            ? skillAllowedTools.filter((s: string) => !agentAllowed || agentAllowed.includes(s))
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
            excludedServerNames: this.getExcludedServerNames(),
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
