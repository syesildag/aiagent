import { Request, Response, Router } from "express";
import aiagentconversationsRepository from "../entities/ai-agent-conversations";
import aiagentconversationmessagesRepository from "../entities/ai-agent-conversation-messages";
import { AiAgentConversationMessages } from "../entities/ai-agent-conversation-messages";
import aiagentsessionRepository from "../entities/ai-agent-session";
import { asyncHandler } from "../utils/asyncHandler";

export const conversationsRouter = Router();

// Resolve and validate session from query string or body — used by all conversation routes
async function resolveSession(req: Request, res: Response) {
   const session = (req.query.session ?? req.body?.session) as string | undefined;
   if (!session) { res.status(401).json({ error: 'No session' }); return null; }
   const sessionEntity = await aiagentsessionRepository.findByName(session);
   if (!sessionEntity) { res.status(401).json({ error: 'Invalid session' }); return null; }
   return sessionEntity;
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
   const convId = parseInt(req.params.id, 10);
   const conv = await aiagentconversationsRepository.getById(convId);
   if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }
   const convSession = await aiagentsessionRepository.getById(conv.getSessionId());
   if (!convSession || convSession.getUserLogin() !== sessionEntity.getUserLogin()) {
      res.status(404).json({ error: 'Conversation not found' }); return;
   }
   await conv.delete();
   res.json({ ok: true });
}));

// Get messages for a conversation
conversationsRouter.get("/:id/messages", asyncHandler(async (req: Request, res: Response) => {
   const sessionEntity = await resolveSession(req, res);
   if (!sessionEntity) return;
   const convId = parseInt(req.params.id, 10);
   const conv = await aiagentconversationsRepository.getById(convId);
   if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }
   const convSession = await aiagentsessionRepository.getById(conv.getSessionId());
   if (!convSession || convSession.getUserLogin() !== sessionEntity.getUserLogin()) {
      res.status(404).json({ error: 'Conversation not found' }); return;
   }
   const messages = await aiagentconversationmessagesRepository.findByConversationId(convId);
   res.json({
      messages: messages.map((m: AiAgentConversationMessages) => ({
         id: m.getId(),
         role: m.getRole(),
         content: m.getContent(),
         timestamp: m.getTimestamp(),
      })),
   });
}));
