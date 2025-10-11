#!/usr/bin/env node

/**
 * Time Server Usage Example
 * 
 * This example demonstrates how to use the Time MCP server with various
 * time and timezone operations through natural language queries.
 */

import { MCPServerManager } from '../src/mcp/mcpManager.js';
import Logger from '../src/utils/logger.js';

async function demonstrateTimeServer() {
  const manager = new MCPServerManager();
  
  try {
    Logger.info("Starting Time Server demonstration...");
    
    // Example queries for the time server
    const timeQueries = [
      "What's the current time in New York?",
      "Convert 2:30 PM from London to Tokyo time",
      "What timezone is Sydney, Australia in?",
      "Show me the current time in multiple world cities",
      "What's the time difference between San Francisco and Berlin?",
      "List all available timezones in Europe",
      "Is it currently daylight saving time in New York?",
      "What time will it be in Mumbai when it's 9 AM in London?",
      "Give me the current UTC time",
      "Show me timezone information for America/Los_Angeles"
    ];

    Logger.info("Demonstrating time server capabilities with natural language queries:");
    
    for (let i = 0; i < timeQueries.length; i++) {
      const query = timeQueries[i];
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Query ${i + 1}: ${query}`);
      console.log('='.repeat(60));
      
      try {
        const response = await manager.chatWithLLM({
          message: query,
          customSystemPrompt: "You are a helpful assistant with access to time and timezone tools. Use the available tools to provide accurate time information."
        });
        console.log('\nResponse:');
        console.log(response);
        
        // Add a small delay between queries
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`Error processing query: ${error}`);
      }
    }
    
    Logger.info("Time server demonstration completed successfully");
    
  } catch (error) {
    Logger.error("Time server demonstration failed:", error);
  }
}

// Run the demonstration
demonstrateTimeServer().catch((error) => {
  Logger.error("Unhandled error in time server demonstration:", error);
  process.exit(1);
});