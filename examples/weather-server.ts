#!/usr/bin/env node

/**
 * Weather MCP Server Usage Examples
 * 
 * This file demonstrates how to use the Weather MCP Server
 * through natural language queries using the chatWithLLM method.
 */

import mcpManager from '../src/mcp/mcpManager.js';
import Logger from '../src/utils/logger.js';

async function main() {
  try {
    Logger.info("Starting Weather MCP Server examples...");
    
    // Initialize MCP manager
    await mcpManager.ensureInitialized();
    
    // Example weather queries that will automatically use the weather server tools
    const queries = [
      "What's the current weather in London, UK?",
      "Can you show me the 5-day weather forecast for Tokyo, Japan?",
      "What are the coordinates for Sydney, Australia?",
      "Get me weather alerts for New York City coordinates 40.7128, -74.0060",
      "Show me current weather conditions in Paris, France with metric units"
    ];

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      console.log(`\n=== Example ${i + 1}: ${query} ===`);
      
      try {
        const response = await mcpManager.chatWithLLM({
          message: query,
          customSystemPrompt: "You are a helpful weather assistant. Use the available weather tools to provide accurate, current weather information. Format your responses clearly and include relevant details.",
          stream: false
        });
        
        console.log("Response:", response);
      } catch (error) {
        console.error(`Error with query "${query}":`, error instanceof Error ? error.message : String(error));
      }
      
      // Add delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    Logger.info("Weather MCP Server examples completed successfully!");
    
  } catch (error) {
    Logger.error("Error running weather server examples:", error);
    process.exit(1);
  } finally {
    await mcpManager.stopAllServers();
  }
}

// Run the examples
main().catch(console.error);