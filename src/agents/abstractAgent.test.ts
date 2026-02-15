import AbstractAgent from './abstractAgent';
import { AgentName } from '../agent';
import { AiAgentSession } from '../entities/ai-agent-session';
import { MCPServerManager } from '../mcp/mcpManager';
import Logger from '../utils/logger';
import { Options } from 'ollama';

// Mock dependencies
jest.mock('../utils/logger');

// Concrete test implementation of AbstractAgent
class TestAgent extends AbstractAgent {
  private systemPrompt: string;
  private name: AgentName;
  private allowedServers?: string[];

  constructor(name: AgentName = 'general', systemPrompt: string = 'Test system prompt') {
    super();
    this.name = name;
    this.systemPrompt = systemPrompt;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getName(): AgentName {
    return this.name;
  }

  setAllowedServers(servers: string[] | undefined) {
    this.allowedServers = servers;
  }

  getAllowedServerNames(): string[] | undefined {
    return this.allowedServers;
  }
}

describe('AbstractAgent', () => {
  let agent: TestAgent;
  let mockMCPManager: jest.Mocked<MCPServerManager>;
  let mockSession: AiAgentSession;

  beforeEach(() => {
    jest.clearAllMocks();
    
    agent = new TestAgent();

    // Mock MCP Manager
    mockMCPManager = {
      addAssistantMessageToHistory: jest.fn(),
      chatWithLLM: jest.fn(),
      getToolsForServers: jest.fn(),
      getToolsByServer: jest.fn(),
      getAvailableServerNames: jest.fn(),
    } as any;

    // Mock session
    mockSession = {
      getId: jest.fn().mockReturnValue(1),
    } as any;
  });

  describe('Session management', () => {
    it('should set and get session', () => {
      agent.setSession(mockSession);
      
      const session = agent.getSession();
      expect(session).toBe(mockSession);
    });

    it('should return undefined when no session is set', () => {
      const session = agent.getSession();
      expect(session).toBeUndefined();
    });
  });

  describe('MCP Manager integration', () => {
    it('should set MCP manager', () => {
      mockMCPManager.getToolsByServer.mockReturnValue({});
      agent.setMCPManager(mockMCPManager);
      
      // Verify by calling a method that uses the manager
      const tools = agent.getAvailableTools();
      expect(mockMCPManager.getToolsByServer).toHaveBeenCalled();
    });

    it('should accept null as MCP manager', () => {
      agent.setMCPManager(null);
      
      const tools = agent.getAvailableTools();
      expect(tools).toEqual([]);
    });

    it('should return empty arrays when no MCP manager is set', () => {
      const tools = agent.getAvailableTools();
      expect(tools).toEqual([]);

      const servers = agent.getAvailableServerNames();
      expect(servers).toEqual([]);
    });
  });

  describe('Abstract methods implementation', () => {
    it('should get system prompt from concrete implementation', () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt).toBe('Test system prompt');
    });

    it('should get agent name from concrete implementation', () => {
      const name = agent.getName();
      expect(name).toBe('general');
    });

    it('should support custom agent name', () => {
      const customAgent = new TestAgent('weather', 'Weather prompt');
      expect(customAgent.getName()).toBe('weather');
    });
  });

  describe('Configuration methods', () => {
    it('should return default options with seed and temperature', () => {
      const options = agent.getOptions();
      
      expect(options).toEqual({
        seed: 123,
        temperature: 0,
      });
    });

    it('should return false for shouldValidate by default', () => {
      expect(agent.shouldValidate()).toBe(false);
    });

    it('should return false for validate by default', async () => {
      const result = await agent.validate();
      expect(result).toBe(false);
    });

    it('should accept data parameter in validate', async () => {
      const result = await agent.validate({ key: 'value' });
      expect(result).toBe(false);
    });

    it('should return undefined for getAllowedServerNames by default', () => {
      const servers = agent.getAllowedServerNames();
      expect(servers).toBeUndefined();
    });

    it('should support setting allowed server names', () => {
      agent.setAllowedServers(['server1', 'server2']);
      const servers = agent.getAllowedServerNames();
      expect(servers).toEqual(['server1', 'server2']);
    });
  });

  describe('addAssistantMessageToHistory', () => {
    it('should call MCP manager to add message', () => {
      agent.setMCPManager(mockMCPManager);
      
      agent.addAssistantMessageToHistory('Test message');
      
      expect(mockMCPManager.addAssistantMessageToHistory).toHaveBeenCalledWith('Test message');
    });

    it('should handle undefined message content', () => {
      agent.setMCPManager(mockMCPManager);
      
      agent.addAssistantMessageToHistory(undefined);
      
      expect(mockMCPManager.addAssistantMessageToHistory).toHaveBeenCalledWith(undefined);
    });

    it('should not throw when MCP manager is not initialized', () => {
      expect(() => {
        agent.addAssistantMessageToHistory('Test message');
      }).not.toThrow();
    });

    it('should return without calling manager when manager is null', () => {
      agent.setMCPManager(null);
      
      const result = agent.addAssistantMessageToHistory('Test message');
      
      expect(result).toBeUndefined();
    });
  });

  describe('chat', () => {
    it('should throw error when MCP manager is not initialized', async () => {
      await expect(agent.chat('Hello')).rejects.toThrow('MCP manager not initialized');
    });

    it('should call MCP manager chatWithLLM with correct parameters', async () => {
      agent.setMCPManager(mockMCPManager);
      mockMCPManager.chatWithLLM.mockResolvedValue('Response');

      const response = await agent.chat('Hello');

      expect(mockMCPManager.chatWithLLM).toHaveBeenCalledWith({
        message: 'Hello',
        customSystemPrompt: 'Test system prompt',
        abortSignal: undefined,
        serverNames: undefined,
        stream: undefined,
      });
      expect(response).toBe('Response');
    });

    it('should pass abortSignal to MCP manager', async () => {
      agent.setMCPManager(mockMCPManager);
      mockMCPManager.chatWithLLM.mockResolvedValue('Response');

      const abortController = new AbortController();
      await agent.chat('Hello', abortController.signal);

      expect(mockMCPManager.chatWithLLM).toHaveBeenCalledWith({
        message: 'Hello',
        customSystemPrompt: 'Test system prompt',
        abortSignal: abortController.signal,
        serverNames: undefined,
        stream: undefined,
      });
    });

    it('should pass stream parameter to MCP manager', async () => {
      agent.setMCPManager(mockMCPManager);
      mockMCPManager.chatWithLLM.mockResolvedValue('Response');

      await agent.chat('Hello', undefined, true);

      expect(mockMCPManager.chatWithLLM).toHaveBeenCalledWith({
        message: 'Hello',
        customSystemPrompt: 'Test system prompt',
        abortSignal: undefined,
        serverNames: undefined,
        stream: true,
      });
    });

    it('should use allowed server names when configured', async () => {
      agent.setMCPManager(mockMCPManager);
      agent.setAllowedServers(['server1', 'server2']);
      mockMCPManager.chatWithLLM.mockResolvedValue('Response');

      await agent.chat('Hello');

      expect(mockMCPManager.chatWithLLM).toHaveBeenCalledWith({
        message: 'Hello',
        customSystemPrompt: 'Test system prompt',
        abortSignal: undefined,
        serverNames: ['server1', 'server2'],
        stream: undefined,
      });
    });

    it('should return stream when stream is enabled', async () => {
      agent.setMCPManager(mockMCPManager);
      const mockStream = new ReadableStream();
      mockMCPManager.chatWithLLM.mockResolvedValue(mockStream);

      const response = await agent.chat('Hello', undefined, true);

      expect(response).toBe(mockStream);
    });

    it('should log and throw error on MCP failure', async () => {
      agent.setMCPManager(mockMCPManager);
      const error = new Error('MCP error');
      mockMCPManager.chatWithLLM.mockRejectedValue(error);

      await expect(agent.chat('Hello')).rejects.toThrow('MCP error');
      expect(Logger.error).toHaveBeenCalledWith('MCP chat failed: MCP error');
    });

    it('should handle non-Error exceptions', async () => {
      agent.setMCPManager(mockMCPManager);
      mockMCPManager.chatWithLLM.mockRejectedValue('String error');

      await expect(agent.chat('Hello')).rejects.toBe('String error');
      expect(Logger.error).toHaveBeenCalledWith('MCP chat failed: String error');
    });
  });

  describe('getAvailableTools', () => {
    it('should return empty array when MCP manager is not initialized', () => {
      const tools = agent.getAvailableTools();
      expect(tools).toEqual([]);
    });

    it('should get tools for all servers when no filter provided', () => {
      agent.setMCPManager(mockMCPManager);
      mockMCPManager.getToolsByServer.mockReturnValue({
        server1: [
          { function: { name: 'tool1', description: '', parameters: {} } } as any,
          { function: { name: 'tool2', description: '', parameters: {} } } as any,
        ],
        server2: [
          { function: { name: 'tool3', description: '', parameters: {} } } as any,
        ],
      });

      const tools = agent.getAvailableTools();

      expect(tools).toEqual(['tool1', 'tool2', 'tool3']);
      expect(mockMCPManager.getToolsByServer).toHaveBeenCalled();
    });

    it('should get tools for specific servers when filter provided', () => {
      agent.setMCPManager(mockMCPManager);
      mockMCPManager.getToolsForServers.mockReturnValue([
        { function: { name: 'tool1', description: '', parameters: {} } } as any,
        { function: { name: 'tool2', description: '', parameters: {} } } as any,
      ]);

      const tools = agent.getAvailableTools(['server1']);

      expect(tools).toEqual(['tool1', 'tool2']);
      expect(mockMCPManager.getToolsForServers).toHaveBeenCalledWith(['server1']);
    });

    it('should use agent allowed servers when no parameter provided', () => {
      agent.setMCPManager(mockMCPManager);
      agent.setAllowedServers(['server1', 'server2']);
      mockMCPManager.getToolsForServers.mockReturnValue([
        { function: { name: 'tool1', description: '', parameters: {} } } as any,
      ]);

      const tools = agent.getAvailableTools();

      expect(tools).toEqual(['tool1']);
      expect(mockMCPManager.getToolsForServers).toHaveBeenCalledWith(['server1', 'server2']);
    });

    it('should prefer parameter servers over agent allowed servers', () => {
      agent.setMCPManager(mockMCPManager);
      agent.setAllowedServers(['server1', 'server2']);
      mockMCPManager.getToolsForServers.mockReturnValue([
        { function: { name: 'tool3', description: '', parameters: {} } } as any,
      ]);

      const tools = agent.getAvailableTools(['server3']);

      expect(tools).toEqual(['tool3']);
      expect(mockMCPManager.getToolsForServers).toHaveBeenCalledWith(['server3']);
    });

    it('should handle empty server list', () => {
      agent.setMCPManager(mockMCPManager);
      mockMCPManager.getToolsByServer.mockReturnValue({});

      const tools = agent.getAvailableTools([]);

      expect(tools).toEqual([]);
    });
  });

  describe('getAvailableServerNames', () => {
    it('should return empty array when MCP manager is not initialized', () => {
      const servers = agent.getAvailableServerNames();
      expect(servers).toEqual([]);
    });

    it('should get available server names from MCP manager', () => {
      agent.setMCPManager(mockMCPManager);
      mockMCPManager.getAvailableServerNames.mockReturnValue(['server1', 'server2', 'server3']);

      const servers = agent.getAvailableServerNames();

      expect(servers).toEqual(['server1', 'server2', 'server3']);
      expect(mockMCPManager.getAvailableServerNames).toHaveBeenCalled();
    });

    it('should handle empty server list', () => {
      agent.setMCPManager(mockMCPManager);
      mockMCPManager.getAvailableServerNames.mockReturnValue([]);

      const servers = agent.getAvailableServerNames();

      expect(servers).toEqual([]);
    });
  });

  describe('Integration scenarios', () => {
    it('should support full agent workflow', async () => {
      // Setup
      agent.setSession(mockSession);
      agent.setMCPManager(mockMCPManager);
      agent.setAllowedServers(['server1']);
      
      mockMCPManager.getAvailableServerNames.mockReturnValue(['server1', 'server2']);
      mockMCPManager.getToolsForServers.mockReturnValue([
        { function: { name: 'tool1', description: '', parameters: {} } } as any,
      ]);
      mockMCPManager.chatWithLLM.mockResolvedValue('Response');

      // Verify
      expect(agent.getSession()).toBe(mockSession);
      expect(agent.getAvailableServerNames()).toEqual(['server1', 'server2']);
      expect(agent.getAvailableTools()).toEqual(['tool1']);

      const response = await agent.chat('Hello');
      expect(response).toBe('Response');

      agent.addAssistantMessageToHistory('Response');
      expect(mockMCPManager.addAssistantMessageToHistory).toHaveBeenCalledWith('Response');
    });

    it('should handle agent without session', async () => {
      agent.setMCPManager(mockMCPManager);
      mockMCPManager.chatWithLLM.mockResolvedValue('Response');

      expect(agent.getSession()).toBeUndefined();
      
      const response = await agent.chat('Hello');
      expect(response).toBe('Response');
    });

    it('should work with default configuration', () => {
      expect(agent.getOptions()).toEqual({ seed: 123, temperature: 0 });
      expect(agent.shouldValidate()).toBe(false);
      expect(agent.getAllowedServerNames()).toBeUndefined();
    });
  });
});
