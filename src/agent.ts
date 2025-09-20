import { Options } from 'ollama';
import { Session } from './repository/entities/session';
import Logger from './utils/logger';
import AbstractAgent from './agents/abstractAgent';
import { MCPServerManager } from './mcp/mcpManager';
import { createLLMProvider, getLLMModel } from './mcp/llmFactory';
import { config } from './utils/config';

export type AgentName = string;

export interface Agent {
   setSession(session: Session): void;
   shouldValidate(): boolean;
   chat(prompt: string): Promise<string>;
   validate(data?: any): Promise<boolean>;
   getToolSystemPrompt(): string | undefined;
   getSystemPrompt(): string | undefined;
   getUserPrompt(question: string): string;
   getAssistantPrompt(): string | undefined;
   getName(): AgentName;
   getOptions(): Partial<Options> | undefined;
}

// Simple general-purpose agent class
class GeneralAgent extends AbstractAgent {
   constructor(private name: AgentName) {
      super();
   }

   getName(): AgentName {
      return this.name;
   }

   getSystemPrompt(): string {
      return `You are a helpful AI assistant. You have access to various tools and capabilities through the MCP (Model Context Protocol) system.`;
   }
}

let Agents: Record<string, Agent> = {};
let initialized = false;
let globalMCPManager: MCPServerManager | null = null;

export async function initializeAgents(): Promise<Record<string, Agent>> {
   if (initialized) {
      return Agents;
   }

   // Initialize global MCP manager
   const llmProvider = createLLMProvider();
   const model = getLLMModel();
   globalMCPManager = new MCPServerManager(config.MCP_SERVERS_PATH, llmProvider, model);
   
   try {
      await globalMCPManager.loadServersConfig();
      await globalMCPManager.startAllServers();
      Logger.info('Global MCP manager initialized successfully');
   } catch (error) {
      Logger.error(`Failed to initialize global MCP manager: ${error}`);
   }

   // Create agents with specialized system prompts
   const generalAgent = new GeneralAgent('general');
   
   // Set the global MCP manager for all agents
   const agents = [generalAgent];
   for (const agent of agents) {
      if ('setMCPManager' in agent && typeof agent.setMCPManager === 'function') {
         (agent as any).setMCPManager(globalMCPManager);
      }
   }

   Agents = {
      general: generalAgent
   };
   
   initialized = true;
   
   Logger.info(`Initialized ${Object.keys(Agents).length} agents: ${Object.keys(Agents).join(', ')}`);
   
   return Agents;
}

export async function getAgentFromName(agentName: string): Promise<Agent> {
   if (!initialized) {
      await initializeAgents();
   }
   
   const agent = Agents[agentName];
   if (!agent) {
      const availableAgents = Object.keys(Agents);
      throw new Error(`Invalid agent selected: ${agentName}. Available agents: ${availableAgents.join(', ')}`);
   }
   return agent;
}

export async function getAvailableAgentNames(): Promise<string[]> {
   if (!initialized) {
      await initializeAgents();
   }
   return Object.keys(Agents);
}

export function getGlobalMCPManager(): MCPServerManager | null {
   return globalMCPManager;
}

export async function shutdownAgentSystem(): Promise<void> {
   if (globalMCPManager) {
      try {
         await globalMCPManager.stopAllServers();
         Logger.info('MCP servers shut down successfully');
      } catch (error) {
         Logger.error(`Error shutting down MCP servers: ${error}`);
      }
      globalMCPManager = null;
   }
   initialized = false;
}