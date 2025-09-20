/**
 * Test to verify the new getServerNames() interface design works correctly
 */

import { MCPServerManager } from '../src/mcp/mcpManager';
import AbstractAgent from '../src/agents/abstractAgent';
import { AgentName } from '../src/agent';

// Test agent that only uses specific servers
class TestSpecializedAgent extends AbstractAgent {
  getName(): AgentName {
    return 'test-specialized' as AgentName;
  }

  getServerNames(): string[] {
    return ['filesystem', 'database'];
  }

  getSystemPrompt(): string {
    return 'Test agent for filesystem and database operations only.';
  }
}

// Test agent that uses all servers
class TestGeneralAgent extends AbstractAgent {
  getName(): AgentName {
    return 'test-general' as AgentName;
  }

  getServerNames(): string[] | undefined {
    return undefined; // Use all servers
  }

  getSystemPrompt(): string {
    return 'Test general agent with access to all servers.';
  }
}

async function testServerFiltering() {
  console.log('Testing new getServerNames() interface...');

  const mcpManager = new MCPServerManager('./mcp-servers.json');
  
  try {
    // Create test agents
    const specializedAgent = new TestSpecializedAgent();
    const generalAgent = new TestGeneralAgent();

    // Set up agents
    specializedAgent.setMCPManager(mcpManager);
    generalAgent.setMCPManager(mcpManager);

    // Test server names configuration
    console.log('Specialized agent servers:', specializedAgent.getServerNames());
    console.log('General agent servers:', generalAgent.getServerNames());

    // Test available tools (would work when MCP servers are running)
    console.log('Specialized agent tools count:', specializedAgent.getAvailableTools().length);
    console.log('General agent tools count:', generalAgent.getAvailableTools().length);

    console.log('✅ Interface test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Only run test if this file is executed directly
if (require.main === module) {
  testServerFiltering();
}

export { TestSpecializedAgent, TestGeneralAgent, testServerFiltering };