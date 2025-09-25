#!/usr/bin/env ts-node

/**
 * Example demonstrating conversation history functionality
 * 
 * This example shows how to:
 * - Use conversation history with MCPServerManager
 * - Start new conversations
 * - View conversation history
 * - Switch between conversations
 * - Configure sliding window size
 */

import "dotenv/config";
import { MCPServerManager } from '../src/mcp/mcpManager';
import { OllamaProvider } from '../src/mcp/llmProviders';
import Logger from '../src/utils/logger';

async function demonstrateConversationHistory() {
  Logger.info('=== Conversation History Example ===');
  
  // Create MCP Server Manager with default conversation history
  const manager = new MCPServerManager(
    './mcp-servers.json',
    new OllamaProvider(),
    'qwen3:4b'
  );

  try {
    // Start a new conversation
    Logger.info('\n1. Starting a new conversation...');
    const conversationId1 = await manager.startNewConversation();
    Logger.info(`Created conversation: ${conversationId1}`);

    // Simulate some chat interactions
    Logger.info('\n2. Adding some messages to the conversation...');
    // Note: In actual usage, these messages are automatically added by chatWithLLM()
    // But for demonstration, we'll show the concept
    
    // Show current conversation
    Logger.info('\n3. Getting current conversation messages...');
    let currentMessages = await manager.getCurrentConversation();
    Logger.info(`Current conversation has ${currentMessages.length} messages`);

    // Start another conversation
    Logger.info('\n4. Starting second conversation...');
    const conversationId2 = await manager.startNewConversation('session2', 'user123');
    Logger.info(`Created second conversation: ${conversationId2}`);

    // Show conversation history
    Logger.info('\n5. Getting conversation history...');
    const conversations = await manager.getConversations();
    Logger.info(`Total conversations: ${conversations.length}`);
    conversations.forEach((conv, index) => {
      Logger.info(`  ${index + 1}. ${conv.id} - ${conv.messages.length} messages`);
    });

    // Show conversation count
    const count = await manager.getConversationCount();
    Logger.info(`\n6. Total conversation count: ${count}`);

    // Demonstrate sliding window by creating many conversations
    Logger.info('\n7. Testing sliding window (creating 15 conversations)...');
    for (let i = 0; i < 15; i++) {
      await manager.startNewConversation(`session_${i}`, `user_${i}`);
    }

    const finalConversations = await manager.getConversations();
    Logger.info(`After creating 15+ conversations, window size is: ${finalConversations.length}`);
    Logger.info('(Should be max 10 due to CONVERSATION_HISTORY_WINDOW_SIZE)');

    // Clear history
    Logger.info('\n8. Clearing conversation history...');
    await manager.clearConversationHistory();
    const clearedCount = await manager.getConversationCount();
    Logger.info(`Conversation count after clearing: ${clearedCount}`);

    Logger.info('\n=== Example completed successfully! ===');

  } catch (error) {
    Logger.error(`Error during example: ${error}`);
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  demonstrateConversationHistory().catch(error => {
    Logger.error(`Example failed: ${error}`);
    process.exit(1);
  });
}

export { demonstrateConversationHistory };