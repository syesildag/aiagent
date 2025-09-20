import { Options } from 'ollama';
import { GeneralAgent } from './agents/generalAgent';
import { createLLMProvider, getLLMModel } from './mcp/llmFactory';
import { MCPServerManager } from './mcp/mcpManager';
import { Session } from './repository/entities/session';
import { config } from './utils/config';
import Logger from './utils/logger';

export type AgentName = 'general' | 'weather';

export interface Agent {
   setSession(session: Session): void;
   shouldValidate(): boolean;
   chat(prompt: string, abortSignal?: AbortSignal): Promise<string>;
   validate(data?: any): Promise<boolean>;
   getSystemPrompt(): string | undefined;
   getName(): AgentName;
   getOptions(): Partial<Options> | undefined;
   setMCPManager(manager: MCPServerManager): void;
   getServerNames(): string[] | undefined;
}

const Agents: Record<string, Agent> = {};
let initialized = false;
let globalMCPManager: MCPServerManager | null = null;

export async function initializeAgents(): Promise<Record<AgentName, Agent>> {
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

   [
      new GeneralAgent('general'),
   ]
   .forEach(agent => {
      Agents[agent.getName()] = agent;
      // Set the global MCP manager for all agents
      agent.setMCPManager(globalMCPManager);
   });

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