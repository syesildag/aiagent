import { Request, Response, Router } from "express";
import aiagentconversationsRepository from "../entities/ai-agent-conversations";
import aiagentconversationmessagesRepository from "../entities/ai-agent-conversation-messages";
import { AiAgentConversationMessages } from "../entities/ai-agent-conversation-messages";
import { resolveActiveSession } from "../middleware/session";
import { asyncHandler } from "../utils/asyncHandler";

export const conversationsRouter = Router();

// Resolve and validate session from query string or body — used by all conversation routes.
// Goes through resolveActiveSession so expired sessions are rejected here too.
async function resolveSession(req: Request, res: Response) {
   const session = req.query.session ?? req.body?.session;
   if (!session) { res.status(401).json({ error: 'No session' }); return null; }
   const sessionEntity = await resolveActiveSession(session);
   if (!sessionEntity) { res.status(401).json({ error: 'Invalid session' }); return null; }
   return sessionEntity;
}

/** Parse a positive integer route id, or null when malformed. */
function parseConversationId(raw: string): number | null {
   return /^\d+$/.test(raw) ? Number(raw) : null;
}

// List conversations for the authenticated user
conversationsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
   const sessionEntity = await resolveSession(req, res);
   if (!sessionEntity) return;
   const conversations = await aiagentconversationsRepository.findByUserLogin(sessionEntity.getUserLogin());
   res.json({ conversations });
}));

// Delete all conversations for the authenticated user
conversationsRouter.delete("/", asyncHandler(async (req: Request, res: Response) => {
   const sessionEntity = await resolveSession(req, res);
   if (!sessionEntity) return;
   const conversations = await aiagentconversationsRepository.findByUserLogin(sessionEntity.getUserLogin());
   await Promise.all(conversations.map(async (c) => {
      const conv = await aiagentconversationsRepository.getById(c.id);
      if (conv) await conv.delete();
   }));
   res.json({ ok: true, deleted: conversations.length });
}));

// Delete a single conversation
conversationsRouter.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
   const sessionEntity = await resolveSession(req, res);
   if (!sessionEntity) return;
   const convId = parseConversationId(req.params.id);
   if (convId === null) { res.status(400).json({ error: 'Invalid conversation id' }); return; }
   const conv = await aiagentconversationsRepository.getById(convId);
   if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }
   if (!await aiagentconversationsRepository.belongsToUserLogin(convId, sessionEntity.getUserLogin())) {
      res.status(403).json({ error: 'Conversation not found' }); return;
   }
   await conv.delete();
   res.json({ ok: true });
}));

// Get messages for a conversation
conversationsRouter.get("/:id/messages", asyncHandler(async (req: Request, res: Response) => {
   const sessionEntity = await resolveSession(req, res);
   if (!sessionEntity) return;
   const convId = parseConversationId(req.params.id);
   if (convId === null) { res.status(400).json({ error: 'Invalid conversation id' }); return; }
   const conv = await aiagentconversationsRepository.getById(convId);
   if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }
   if (!await aiagentconversationsRepository.belongsToUserLogin(convId, sessionEntity.getUserLogin())) {
      res.status(403).json({ error: 'Conversation not found' }); return;
   }
   const messages = await aiagentconversationmessagesRepository.findByConversationId(convId);
   res.json({
      messages: messages
         .filter((m: AiAgentConversationMessages) =>
            (m.getRole() === 'user' || m.getRole() === 'assistant') && m.getContent()
         )
         .map((m: AiAgentConversationMessages) => ({
            id: m.getId(),
            role: m.getRole(),
            content: m.getContent(),
            timestamp: m.getTimestamp(),
         })),
   });
}));
