/**
 * Example demonstrating how agents can filter MCP tools by server name
 * for specialized functionality and better performance.
 */

import { MCPServerManager } from '../src/mcp/mcpManager';
import AbstractAgent from '../src/agents/abstractAgent';
import { AgentName } from '../src/agent';

// Example specialized agent that only uses file system and database tools
class FileSystemDatabaseAgent extends AbstractAgent {
  private allowedServers = ['filesystem', 'postgres', 'sqlite'];

  getName(): AgentName {
    return 'filesystem-database-agent' as AgentName;
  }

  getAllowedServerNames(): string[] {
    return this.allowedServers;
  }

  getSystemPrompt(): string {
    return `You are a specialized agent focused on file system operations and database management.
You have access to tools from specific MCP servers for:
- File system operations (reading, writing, listing files)
- Database queries and management
- SQLite operations

Focus on these capabilities and provide detailed, accurate responses for file and database operations.`;
  }

  // Helper method to check available tools for this agent
  getAvailableTools(): string[] {
    return super.getAvailableTools(); // Will automatically use this.getServerNames()
  }
}

// Example of a web-focused agent
class WebSearchAgent extends AbstractAgent {
  private allowedServers = ['web-search', 'browser', 'crawl'];

  getName(): AgentName {
    return 'web-search-agent' as AgentName;
  }

  getAllowedServerNames(): string[] {
    return this.allowedServers;
  }

  getSystemPrompt(): string {
    return `You are a specialized web search and browsing agent.
You have access to tools for:
- Web searching and information retrieval
- Browser automation and interaction
- Web crawling and content extraction

Focus on finding and extracting information from the web with high accuracy and relevance.`;
  }
}

// Example usage function
async function demonstrateSpecializedAgents() {
  const mcpManager = new MCPServerManager('./mcp-servers.json');
  
  try {
    // Load and start MCP servers
    await mcpManager.loadServersConfig();
    await mcpManager.startAllServers();

    // Create specialized agents
    const fileAgent = new FileSystemDatabaseAgent();
    const webAgent = new WebSearchAgent();

    // Set up agents with MCP manager
    fileAgent.setMCPManager(mcpManager);
    webAgent.setMCPManager(mcpManager);

    console.log('Available servers:', mcpManager.getAvailableServerNames());
    console.log('Tools by server:', Object.keys(mcpManager.getToolsByServer()));

    // Demonstrate tool filtering
    console.log('\nFile Agent available tools:', fileAgent.getAvailableTools());
    console.log('File Agent server names:', fileAgent.getAllowedServerNames());

    // Example interactions
    console.log('\n--- File Agent Response ---');
    const fileResponse = await fileAgent.chat('List the files in the current directory and analyze any configuration files');
    console.log(fileResponse);

    console.log('\n--- Web Agent Response ---');
    const webResponse = await webAgent.chat('Search for the latest TypeScript best practices and summarize the findings');
    console.log(webResponse);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mcpManager.stopAllServers();
  }
}

// Export for use in other examples
export { FileSystemDatabaseAgent, WebSearchAgent, demonstrateSpecializedAgents };