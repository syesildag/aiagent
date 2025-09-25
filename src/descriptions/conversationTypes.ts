import { z } from 'zod';

// Zod schemas for validation
export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  toolCalls: z.array(z.object({
    id: z.string(),
    type: z.string(),
    function: z.object({
      name: z.string(),
      arguments: z.string()
    })
  })).optional(),
  toolCallId: z.string().optional(),
  timestamp: z.date(),
  metadata: z.record(z.any()).optional()
});

export const ConversationSchema = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  messages: z.array(MessageSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.record(z.any()).optional()
});

// TypeScript types derived from schemas
export type Message = z.infer<typeof MessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;

// Interface for conversation history management
export interface IConversationHistory {
  /**
   * Add a message to the current conversation
   */
  addMessage(message: Omit<Message, 'id' | 'timestamp'>): Promise<Message>;
  
  /**
   * Get the current conversation messages
   */
  getCurrentConversation(): Promise<Message[]>;
  
  /**
   * Get all conversations within the sliding window
   */
  getConversations(limit?: number): Promise<Conversation[]>;
  
  /**
   * Start a new conversation
   */
  startNewConversation(sessionId?: string, userId?: string): Promise<string>;
  
  /**
   * Get conversation by ID
   */
  getConversation(conversationId: string): Promise<Conversation | null>;
  
  /**
   * Clear all conversations
   */
  clearHistory(): Promise<void>;
  
  /**
   * Get conversation count
   */
  getConversationCount(): Promise<number>;
}