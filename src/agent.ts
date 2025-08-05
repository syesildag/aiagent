import { Options } from 'ollama';
import Instrumentation from './utils/instrumentation';
import { Session } from './repository/entities/session';
import { McpAgentFactory } from './agents/mcpFactory';
import { McpConfigParser } from './mcp/configParser';
import { McpServerManager } from './mcp/serverManager';
import Logger from './utils/logger';
import { config } from './utils/config';

import './agents/databaseAgent';
import './agents/weatherAgent';

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
   getInstrumentation(): Instrumentation;
   getOptions(): Partial<Options> | undefined;
}

let Agents: Record<string, Agent> = {};
let initialized = false;

async function initializeAgents(): Promise<Record<string, Agent>> {
   if (initialized) {
      return Agents;
   }

   const factory = McpAgentFactory.getInstance();
   
   try {
      const configParser = new McpConfigParser();
      const mcpServerConfigs = await configParser.parseConfigFile(config.MCP_CONFIG_PATH);
      const enabledServers = configParser.getEnabledServers(mcpServerConfigs);
      
      if (Object.keys(enabledServers).length > 0) {
         Logger.info(`Found ${Object.keys(enabledServers).length} enabled MCP servers`);
         
         const serverManager = new McpServerManager();
         const mcpServers = await serverManager.startServers(enabledServers);
         
         factory.registerMcpServers(mcpServers);
         Logger.info(`Started ${mcpServers.size} MCP servers successfully`);
      } else {
         Logger.debug('No enabled MCP servers found in config');
      }
   } catch (error) {
      Logger.error(`Failed to initialize MCP servers: ${error instanceof Error ? error.message : String(error)}`);
   }

   Agents = factory.getAllAgents();
   initialized = true;
   
   Logger.info(`Initialized ${Object.keys(Agents).length} total agents: ${Object.keys(Agents).join(', ')}`);
   
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

export async function initializeAgentSystem(): Promise<void> {
   await initializeAgents();
}