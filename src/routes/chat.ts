import { Request, Response, Router } from "express";
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { getAgentFromName, getGlobalMCPManager } from '../agent';
import type { ImageGenerationResult, MixedContentResult } from '../mcp/mcpManager';
import { AiAgentSession } from "../entities/ai-agent-session";
import aiagentuserRepository from "../entities/ai-agent-user";
import { approvalManager } from '../mcp/approvalManager';
import { asyncHandler } from "../utils/asyncHandler";
import Logger from "../utils/logger";
import { processSlashCommand } from '../utils/slashCommandProcessor';
import { handleStreamingResponse } from '../utils/streamUtils';
import { conversationService } from '../services/conversationService';
import { chatService } from '../services/chatService';
import { sendAuthenticationRequired } from "./routeUtils";

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
   const sessionEntity: AiAgentSession | undefined = res.locals.session;
   if (!sessionEntity) {
      sendAuthenticationRequired(res);
      return;
   }
   agent.setSession(sessionEntity);

   // Look up isAdmin here, in a per-request local variable, before any awaits that could
   // race with concurrent requests overwriting the shared singleton agent's session.
   const sessionUserLogin = sessionEntity?.getUserLogin();
   const sessionUser = sessionUserLogin ? await aiagentuserRepository.findByLogin(sessionUserLogin) : null;
   const isAdminUser = sessionUser?.getIsAdmin() ?? false;

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
   const slashResult = processSlashCommand(prompt, getGlobalMCPManager());
   if (slashResult?.kind === 'direct') {
     res.write(JSON.stringify({ t: 'text', v: slashResult.response }) + '\n');
     res.end();
     return;
   }
   const effectivePrompt = slashResult?.kind === 'chat' ? slashResult.effectivePrompt : prompt;
   const toolNameFilter  = slashResult?.kind === 'chat' ? slashResult.toolNameFilter  : undefined;
   const cmdMaxIterations = slashResult?.kind === 'chat' ? slashResult.maxIterations  : undefined;
   const cmdFreshContext  = slashResult?.kind === 'chat' ? slashResult.freshContext   : undefined;
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

   // ── Conversation persistence ───────────────────────────────────────────────
   const userLogin = sessionEntity?.getUserLogin();
   const incomingId = incomingConversationId ?? null;
   const { conversationId: activeConversationId, conversationUuid: activeConversationUuid } =
      await conversationService.resolveOrCreateConversation(sessionEntity, incomingId, prompt);

   if (activeConversationId) {
      res.write(JSON.stringify({ t: 'conversation', id: activeConversationId }) + '\n');
      await conversationService.persistUserMessage(activeConversationId, prompt);
   }

   await conversationService.syncAgentHistory(agent, incomingId, activeConversationId, userLogin ?? undefined, activeConversationUuid);
   // ── End conversation persistence ──────────────────────────────────────────

   try {
      const { answer, finalContent: chatFinalContent } = await chatService.chat({
         agent,
         prompt: effectivePrompt,
         attachments,
         approvalCallback,
         onContextUpdate,
         onCompact,
         isAdmin: isAdminUser,
         toolNameFilter,
         maxIterations: cmdMaxIterations,
         freshContext: cmdFreshContext,
      });

      let finalContent: string | undefined;

      if (answer instanceof ReadableStream) {
         finalContent = await handleStreamingResponse(answer, res, agent.addAssistantMessageToHistory.bind(agent));
      } else if (answer && typeof answer === 'object' && (answer as ImageGenerationResult).kind === 'image') {
         const imageResult = answer as ImageGenerationResult;
         for (const url of imageResult.urls) {
            res.write(JSON.stringify({ t: 'image', v: url }) + '\n');
         }
         finalContent = chatFinalContent;
         await agent.addAssistantMessageToHistory(finalContent);
         res.write(JSON.stringify({ t: 'done' }) + '\n');
         res.end();
      } else if (answer && typeof answer === 'object' && (answer as MixedContentResult).kind === 'mixed') {
         const mixedResult = answer as MixedContentResult;
         if (mixedResult.text) res.write(JSON.stringify({ t: 'text', v: mixedResult.text }) + '\n');
         for (const url of mixedResult.imageUrls) {
            res.write(JSON.stringify({ t: 'image', v: url }) + '\n');
         }
         finalContent = chatFinalContent;
         await agent.addAssistantMessageToHistory(finalContent);
         res.write(JSON.stringify({ t: 'done' }) + '\n');
         res.end();
      } else {
         finalContent = chatFinalContent;
         await agent.addAssistantMessageToHistory(finalContent);
         res.write(JSON.stringify({ t: 'text', v: finalContent }) + '\n');
         res.write(JSON.stringify({ t: 'done' }) + '\n');
         res.end();
      }

      // Persist the assistant reply — skip when DbConversationHistory is active as it already persisted the message via addAssistantMessageToHistory().
      if (userLogin && activeConversationId && finalContent) {
         await conversationService.persistAssistantMessage(activeConversationId, finalContent);
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
