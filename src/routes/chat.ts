import { Request, Response, Router } from "express";
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { getAgentFromName, getGlobalMCPManager } from '../agent';
import type { ImageGenerationResult, MixedContentResult } from '../mcp/mcpManager';
import { AiAgentConversationMessages } from "../entities/ai-agent-conversation-messages";
import aiagentconversationmessagesRepository from "../entities/ai-agent-conversation-messages";
import aiagentconversationsRepository, { AiAgentConversations } from "../entities/ai-agent-conversations";
import { AiAgentSession } from "../entities/ai-agent-session";
import { approvalManager } from '../mcp/approvalManager';
import { asyncHandler } from "../utils/asyncHandler";
import { processCommand } from '../utils/commandProcessor';
import Logger from "../utils/logger";
import { config } from '../utils/config';
import { slashCommandRegistry } from '../utils/slashCommandRegistry';
import { handleStreamingResponse } from '../utils/streamUtils';

export const chatRouter = Router();

const CHAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const ALLOWED_MIME_TYPES = [
   'image/png', 'image/jpeg', 'image/gif', 'image/webp',
   'application/pdf', 'text/plain',
] as const;

// ~7.5 MB when decoded from base64
const MAX_FILE_BASE64_LENGTH = 10 * 1024 * 1024;

const Query = z.object({
   session: z.string().optional().describe('The session id'),
   prompt: z.string().describe('user prompt'),
   conversationId: z.number().optional().describe('Existing conversation id to continue'),
   // Legacy single-image fields (kept for backward compatibility)
   imageBase64: z.string().max(MAX_FILE_BASE64_LENGTH).optional().describe('base64-encoded image data'),
   imageMimeType: z.enum(ALLOWED_MIME_TYPES).optional().describe('MIME type of the image'),
   // Multi-file support: array of {base64, mimeType, name?} objects
   files: z.array(
     z.object({
       base64: z.string().max(MAX_FILE_BASE64_LENGTH),
       mimeType: z.enum(ALLOWED_MIME_TYPES),
       name: z.string().optional(),
     })
   ).max(5).optional().describe('Array of attached files (max 5)'),
});

// Per-session rate limiter for the chat endpoint (applied after body parsing so
// req.body.session is available). Falls back to IP when no session is present.
const chatRateLimit = rateLimit({
   windowMs: 1 * 60 * 1000,
   limit: 20, // 20 chat requests per minute per session
   standardHeaders: 'draft-8',
   legacyHeaders: false,
   keyGenerator: (req) => req.body?.session ?? req.ip ?? 'unknown',
});

// Separate rate limiter for the approval endpoint to prevent brute-forcing approval IDs
const approvalRateLimit = rateLimit({
   windowMs: 60 * 1000,
   limit: 10,
   standardHeaders: 'draft-8',
   legacyHeaders: false,
   keyGenerator: (req) => req.ip ?? 'unknown',
   message: { error: 'Too many approval attempts' },
});

// Approve / deny a pending tool execution (called by the browser when the user decides).
// IMPORTANT: must be registered BEFORE /:agent to avoid the wildcard swallowing this path.
chatRouter.post("/approve/:approvalId", approvalRateLimit, asyncHandler(async (req: Request, res: Response) => {
   const { approvalId } = req.params;
   const { approved } = z.object({ approved: z.boolean() }).parse(req.body);
   const resolved = approvalManager.resolve(approvalId, approved);
   if (!resolved) {
      res.status(404).json({ error: 'Approval request not found or already resolved' });
      return;
   }
   Logger.info(`Tool approval ${approvalId}: ${approved ? 'APPROVED' : 'DENIED'}`);
   res.json({ success: true });
}));

chatRouter.post("/:agent", chatRateLimit, asyncHandler(async (req: Request, res: Response) => {
   const { prompt, imageBase64, imageMimeType, files, conversationId: incomingConversationId } = Query.parse(req.body);
   const agent = await getAgentFromName(req.params.agent);
   const sessionEntity: AiAgentSession = res.locals.session;
   agent.setSession(sessionEntity);

   // Build the image-data array, merging legacy single-image fields and the new multi-file array
   const attachmentsArray: { base64: string; mimeType: string; name?: string }[] = [];
   if (files && files.length > 0) {
     attachmentsArray.push(...files);
   } else if (imageBase64 && imageMimeType) {
     attachmentsArray.push({ base64: imageBase64, mimeType: imageMimeType });
   }
   const attachments = attachmentsArray.length > 0 ? attachmentsArray : undefined;

   // All responses use NDJSON so we can multiplex approval events and text chunks
   // on the same stream (MCP 2025-11-25 human-in-the-loop pattern).
   res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
   res.setHeader('Transfer-Encoding', 'chunked');
   res.setHeader('Cache-Control', 'no-cache');
   res.flushHeaders();  // open the connection now so early writes (approvals) reach the client

   // ── Slash command processing ───────────────────────────────────────────────
   slashCommandRegistry.initialize();
   let effectivePrompt = prompt;
   let toolNameFilter: string[] | undefined;
   let cmdMaxIterations: number | undefined;
   let cmdFreshContext: boolean | undefined;

   if (slashCommandRegistry.hasCommand(prompt)) {
     const parsed = slashCommandRegistry.parseInput(prompt);
     if (parsed) {
       const cmd = slashCommandRegistry.getCommand(parsed.name)!;
       toolNameFilter = cmd.allowedTools;
       cmdMaxIterations = cmd.maxIterations;
       cmdFreshContext = cmd.freshContext;

       if (cmd.disableModelInvocation) {
         // Special case: mcp-status builds its response directly from the in-process
         // MCPServerManager to avoid a deadlock (execSync bash capture + self-HTTP call
         // would block the event loop before the server could respond to itself).
         if (parsed.name === 'mcp-status') {
           const manager = getGlobalMCPManager();
           let text: string;
           if (!manager) {
             text = 'MCP manager not initialised yet.';
           } else {
             const serverStatus = manager.getServerStatus();
             const cacheValid = manager.isToolsCacheValid();
             const cachedCount = manager.getCachedToolsCount();
             const toolsByServer = manager.getToolsByServer();
             const serverEntries = Object.entries(serverStatus);
             const runningCount = serverEntries.filter(([, s]) => s.running).length;

             const lines: string[] = [];
             lines.push('# 🔌 MCP Status');
             lines.push('');
             lines.push('## Cache');
             lines.push('');
             lines.push('| Property | Value |');
             lines.push('|---|---|');
             lines.push(`| Status | ${cacheValid ? '✅ Valid' : '⚠️ Stale'} |`);
             lines.push(`| Total tools | ${cachedCount} |`);
             lines.push(`| Servers | ${runningCount} running / ${serverEntries.length} total |`);
             lines.push('');
             lines.push('---');
             lines.push('');
             lines.push('## Servers');
             lines.push('');

             for (const [serverName, info] of serverEntries) {
               const serverTools = toolsByServer[serverName] ?? [];
               const statusIcon = info.running ? '🟢' : '🔴';
               const statusLabel = info.running ? 'running' : 'stopped';

               lines.push(`### ${statusIcon} \`${serverName}\` — ${statusLabel}`);
               lines.push('');
               lines.push('| | Count |');
               lines.push('|---|---|');
               lines.push(`| 🛠 Tools | ${info.tools.length} |`);
               lines.push(`| 📦 Resources | ${info.resources.length} |`);
               lines.push(`| 💬 Prompts | ${info.prompts.length} |`);

               if (serverTools.length > 0) {
                 lines.push('');
                 lines.push('<details><summary>📋 Cached tools</summary>');
                 lines.push('');
                 lines.push('| Tool | Description |');
                 lines.push('|---|---|');
                 for (const tool of serverTools) {
                   lines.push(`| \`${tool.function.name}\` | ${tool.function.description ?? '—'} |`);
                 }
                 lines.push('');
                 lines.push('</details>');
               }
               lines.push('');
             }

             text = lines.join('\n');
           }
           res.write(JSON.stringify({ t: 'text', v: text }) + '\n');
           res.end();
           return;
         }

         // Return the processed body directly without calling the LLM
         const body = processCommand(cmd, parsed.args, slashCommandRegistry.getSkills());
         res.write(JSON.stringify({ t: 'text', v: body }) + '\n');
         res.end();
         return;
       }

       effectivePrompt = processCommand(cmd, parsed.args, slashCommandRegistry.getSkills());
     }
   }
   // ── End slash command processing ──────────────────────────────────────────

   // Abort the request after timeout so slow LLMs/MCP servers don't hang forever
   const timeoutId = setTimeout(() => {
      if (!res.writableEnded) {
         res.write(JSON.stringify({ t: 'error', v: 'Request timed out' }) + '\n');
         res.end();
      }
   }, CHAT_TIMEOUT_MS);

   // Approval callback: broadcasts the approval request event to the browser
   // and then suspends tool execution until the user decides.
   const approvalCallback = async (
     toolName: string,
     args: Record<string, unknown>,
     description: string,
     schema?: { properties?: Record<string, { type?: string; description?: string; [key: string]: unknown }>; required?: string[] },
   ): Promise<boolean> => {
     const request = approvalManager.buildRequest(toolName, args, description);
     const decision = approvalManager.register(request.id);
     // Emit the approval event as an NDJSON line
     res.write(
       JSON.stringify({
         t: 'approval',
         id: request.id,
         tool: request.toolName,
         args: request.args,
         desc: request.description,
         schema,
       }) + '\n',
     );
     return decision;
   };

   // Context usage callback: emits a single NDJSON event with token estimates
   const onContextUpdate = (used: number, max: number): void => {
     if (!res.writableEnded) {
       res.write(JSON.stringify({ t: 'ctx', used, max }) + '\n');
     }
   };

   // Compaction callback: notifies the frontend that history was auto-compacted
   const onCompact = (info: { summarized: number; kept: number; tokensBefore: number; tokensAfter: number }): void => {
     if (!res.writableEnded) {
       res.write(JSON.stringify({ t: 'compact', ...info }) + '\n');
     }
   };

   // Resolve or create a conversation for persistence
   const userLogin = sessionEntity?.getUserLogin();
   let activeConversationId = incomingConversationId ?? null;
   if (userLogin) {
      try {
         // Validate that an incoming conversation ID still exists; if it was deleted
         // (sliding window, server restart, migration reset) treat it as a new conversation
         // to avoid FK violations when inserting messages.
         if (activeConversationId) {
            const existingConv = await aiagentconversationsRepository.getById(activeConversationId);
            if (!existingConv) {
               Logger.warn(`Conversation ${activeConversationId} not found in DB, starting a new one`);
               activeConversationId = null;
            }
         }
         if (!activeConversationId) {
            const title = effectivePrompt.slice(0, 60);
            const conv = await new AiAgentConversations({
               sessionId: sessionEntity.getId()!,
               metadata: { title, userLogin },
            }).save();
            activeConversationId = conv?.getId() ?? null;
         }
         if (activeConversationId) {
            // Emit conversation id so client can continue the conversation
            res.write(JSON.stringify({ t: 'conversation', id: activeConversationId }) + '\n');
            // When DbConversationHistory is active it persists messages itself; skip the direct insert to avoid duplicates and FK violations.
            if (!config.USE_DB_CONVERSATION_HISTORY) {
               await new AiAgentConversationMessages({
                  conversationId: activeConversationId,
                  role: 'user',
                  content: prompt,
               }).save();
            }
         }
      } catch (err) {
         Logger.error(`Failed to persist conversation: ${err}`);
      }
   }

   // Ensure the in-memory LLM context matches the DB conversation being served.
   // Clear and restore whenever the conversation changes (new, switched, or after restart).
   const currentDbConvId = agent.getActiveDbConversationId();
   if (incomingConversationId !== currentDbConvId) {
      try {
         await agent.clearConversationHistory();
         if (incomingConversationId) {
            const priorMessages = await aiagentconversationmessagesRepository.findByConversationId(incomingConversationId);
            if (priorMessages.length > 0) {
               await agent.restoreConversationHistory(
                  priorMessages.map(m => ({ role: m.getRole(), content: m.getContent() })),
                  userLogin ?? undefined,
               );
               Logger.info(`Restored ${priorMessages.length} messages for conversationId=${incomingConversationId}`);
            }
         }
         agent.setActiveDbConversationId(activeConversationId);
      } catch (err) {
         Logger.error(`Failed to sync conversation history: ${err}`);
      }
   }

   try {
      const answer = await agent.chat(effectivePrompt, undefined, true, attachments, approvalCallback, toolNameFilter, cmdMaxIterations, cmdFreshContext, onContextUpdate, onCompact);
      let finalContent: string | undefined;

      if (answer instanceof ReadableStream) {
         finalContent = await handleStreamingResponse(answer, res, agent.addAssistantMessageToHistory.bind(agent));
      } else if (answer && typeof answer === 'object' && (answer as ImageGenerationResult).kind === 'image') {
         const imageResult = answer as ImageGenerationResult;
         for (const url of imageResult.urls) {
            res.write(JSON.stringify({ t: 'image', v: url }) + '\n');
         }
         finalContent = `[Generated image: ${effectivePrompt.slice(0, 60)}]`;
         await agent.addAssistantMessageToHistory(finalContent);
         res.end();
      } else if (answer && typeof answer === 'object' && (answer as MixedContentResult).kind === 'mixed') {
         const mixedResult = answer as MixedContentResult;
         if (mixedResult.text) res.write(JSON.stringify({ t: 'text', v: mixedResult.text }) + '\n');
         for (const url of mixedResult.imageUrls) {
            res.write(JSON.stringify({ t: 'image', v: url }) + '\n');
         }
         finalContent = mixedResult.text || `[Generated image: ${effectivePrompt.slice(0, 60)}]`;
         await agent.addAssistantMessageToHistory(finalContent);
         res.end();
      } else {
         finalContent = answer as string;
         await agent.addAssistantMessageToHistory(finalContent);
         res.write(JSON.stringify({ t: 'text', v: finalContent }) + '\n');
         res.end();
      }

      // Persist the assistant reply — skip when DbConversationHistory is active as it already persisted the message via addAssistantMessageToHistory().
      if (userLogin && activeConversationId && finalContent && !config.USE_DB_CONVERSATION_HISTORY) {
         try {
            await new AiAgentConversationMessages({
               conversationId: activeConversationId,
               role: 'assistant',
               content: finalContent,
            }).save();
            // Update conversation updated_at via a raw update
            await aiagentconversationsRepository.getById(activeConversationId).then(async conv => {
               if (conv) { conv.setUpdatedAt(new Date()); await conv.save(); }
            });
         } catch (err) {
            Logger.error(`Failed to persist assistant message: ${err}`);
         }
      }
   } catch (err) {
      // Headers are already sent (flushHeaders was called), so we cannot send
      // a standard HTTP error response. Write an NDJSON error event instead so
      // the client can display the message, then close the stream cleanly.
      Logger.error(`Chat error for agent '${req.params.agent}': ${err}`);
      if (!res.writableEnded) {
         const message = err instanceof Error ? err.message : String(err);
         res.write(JSON.stringify({ t: 'error', v: message }) + '\n');
         res.end();
      }
   } finally {
      clearTimeout(timeoutId);
   }
}));
