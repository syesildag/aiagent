import { GeneralAgent } from './generalAgent';
import { GENERAL_ASSISTANT_SYSTEM_PROMPT } from '../constants/systemPrompts';
import { AgentName } from '../agent';

describe('GeneralAgent', () => {
  let agent: GeneralAgent;

  beforeEach(() => {
    agent = new GeneralAgent();
  });

  describe('Constructor', () => {
    it('should create instance successfully', () => {
      expect(agent).toBeInstanceOf(GeneralAgent);
    });

    it('should extend AbstractAgent', () => {
      expect(Reflect.getPrototypeOf(agent.constructor)).toBe(require('./abstractAgent').default);
    });
  });

  describe('getName', () => {
    it('should return "general" as agent name', () => {
      const name = agent.getName();
      expect(name).toBe('general');
    });

    it('should return AgentName type', () => {
      const name: AgentName = agent.getName();
      expect(name).toBe('general');
    });
  });

  describe('getSystemPrompt', () => {
    it('should return GENERAL_ASSISTANT_SYSTEM_PROMPT', () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt).toBe(GENERAL_ASSISTANT_SYSTEM_PROMPT);
    });

    it('should return a non-empty string', () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('getAllowedServerNames', () => {
    it('should return undefined to use all servers', () => {
      const servers = agent.getAllowedServerNames();
      expect(servers).toBeUndefined();
    });

    it('should consistently return undefined across multiple calls', () => {
      expect(agent.getAllowedServerNames()).toBeUndefined();
      expect(agent.getAllowedServerNames()).toBeUndefined();
      expect(agent.getAllowedServerNames()).toBeUndefined();
    });
  });

  describe('Inherited AbstractAgent functionality', () => {
    it('should have getOptions method', () => {
      expect(agent.getOptions).toBeDefined();
      expect(typeof agent.getOptions).toBe('function');
    });

    it('should have setMCPManager method', () => {
      expect(agent.setMCPManager).toBeDefined();
      expect(typeof agent.setMCPManager).toBe('function');
    });

    it('should have chat method', () => {
      expect(agent.chat).toBeDefined();
      expect(typeof agent.chat).toBe('function');
    });

    it('should have setSession method', () => {
      expect(agent.setSession).toBeDefined();
      expect(typeof agent.setSession).toBe('function');
    });

    it('should have getSession method', () => {
      expect(agent.getSession).toBeDefined();
      expect(typeof agent.getSession).toBe('function');
    });

    it('should have shouldValidate method', () => {
      expect(agent.shouldValidate).toBeDefined();
      expect(typeof agent.shouldValidate).toBe('function');
    });

    it('should have validate method', () => {
      expect(agent.validate).toBeDefined();
      expect(typeof agent.validate).toBe('function');
    });

    it('should have getAvailableTools method', () => {
      expect(agent.getAvailableTools).toBeDefined();
      expect(typeof agent.getAvailableTools).toBe('function');
    });

    it('should have getAvailableServerNames method', () => {
      expect(agent.getAvailableServerNames).toBeDefined();
      expect(typeof agent.getAvailableServerNames).toBe('function');
    });

    it('should have addAssistantMessageToHistory method', () => {
      expect(agent.addAssistantMessageToHistory).toBeDefined();
      expect(typeof agent.addAssistantMessageToHistory).toBe('function');
    });
  });

  describe('Default AbstractAgent behavior', () => {
    it('should return default options with seed and temperature', () => {
      const options = agent.getOptions();
      expect(options).toHaveProperty('seed');
      expect(options).toHaveProperty('temperature');
      expect(options.seed).toBe(123);
      expect(options.temperature).toBe(0);
    });

    it('should return false for shouldValidate', () => {
      const result = agent.shouldValidate();
      expect(result).toBe(false);
    });

    it('should return false for validate', async () => {
      const result = await agent.validate();
      expect(result).toBe(false);
    });

    it('should return empty array for getAvailableTools when no MCP manager', () => {
      const tools = agent.getAvailableTools();
      expect(tools).toEqual([]);
    });

    it('should return empty array for getAvailableServerNames when no MCP manager', () => {
      const servers = agent.getAvailableServerNames();
      expect(servers).toEqual([]);
    });

    it('should return undefined for getSession when no session set', () => {
      const session = agent.getSession();
      expect(session).toBeUndefined();
    });

    it('should throw error when chat called without MCP manager', async () => {
      await expect(agent.chat('test')).rejects.toThrow('MCP manager not initialized');
    });
  });

  describe('Agent characteristics', () => {
    it('should be designed for general-purpose tasks', () => {
      // General agent should have:
      // 1. No server restrictions (undefined allowedServers)
      // 2. General system prompt
      // 3. 'general' identifier
      
      expect(agent.getAllowedServerNames()).toBeUndefined();
      expect(agent.getName()).toBe('general');
      expect(agent.getSystemPrompt()).toBe(GENERAL_ASSISTANT_SYSTEM_PROMPT);
    });

    it('should allow access to all MCP servers', () => {
      // Unlike specialized agents, general agent should not restrict server access
      const servers = agent.getAllowedServerNames();
      expect(servers).toBeUndefined(); // undefined means "use all servers"
    });
  });
});
