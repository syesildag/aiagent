import { Agent, AgentName } from "../agent";
import AbstractAgent from "./abstractAgent";
import Instrumentation from "../utils/instrumentation";
import { McpServerInstance } from "../mcp/types";
import { McpInstrumentation } from "../mcp/mcpInstrumentation";

export interface AgentConfig {
   name: AgentName;
   instrumentation: Instrumentation;
   systemPrompt?: string;
   toolSystemPrompt?: string;
   assistantPrompt?: string;
   userPromptTemplate?: (question: string) => string;
   validateData?: boolean;
   validator?: (data?: any) => Promise<boolean>;
}

export class McpAgentFactory {
   private static instance: McpAgentFactory;
   private agentConfigs: Map<string, AgentConfig> = new Map();
   private agentInstances: Map<string, Agent> = new Map();
   private mcpServers: Map<string, McpServerInstance> = new Map();

   private constructor() {}

   static getInstance(): McpAgentFactory {
      if (!McpAgentFactory.instance) {
         McpAgentFactory.instance = new McpAgentFactory();
      }
      return McpAgentFactory.instance;
   }

   registerAgent(config: AgentConfig): void {
      this.agentConfigs.set(config.name, config);
   }

   registerMcpServer(name: string, serverInstance: McpServerInstance): void {
      this.mcpServers.set(name, serverInstance);
      
      const mcpInstrumentation = new McpInstrumentation(serverInstance);
      
      const config: AgentConfig = {
         name: name as AgentName,
         instrumentation: mcpInstrumentation,
         systemPrompt: `You are an MCP agent for ${name}. Use the available tools to help users.`,
         toolSystemPrompt: `You have access to tools from the ${name} MCP server.`
      };
      
      this.registerAgent(config);
   }

   registerMcpServers(servers: Map<string, McpServerInstance>): Record<string, Agent> {
      const mcpAgents: Record<string, Agent> = {};
      
      for (const [name, serverInstance] of servers.entries()) {
         if (serverInstance.isRunning) {
            this.registerMcpServer(name, serverInstance);
            mcpAgents[name] = this.getAgent(name as AgentName);
         }
      }
      
      return mcpAgents;
   }

   createAgent(name: AgentName): Agent {
      if (this.agentInstances.has(name)) {
         return this.agentInstances.get(name)!;
      }

      const config = this.agentConfigs.get(name);
      if (!config) {
         throw new Error(`Agent configuration not found for: ${name}`);
      }

      const agent = new McpAgent(config);
      this.agentInstances.set(name, agent);
      return agent;
   }

   getAgent(name: AgentName): Agent {
      return this.createAgent(name);
   }

   getAllAgents(): Record<string, Agent> {
      const agents: Record<string, Agent> = {};
      for (const name of this.agentConfigs.keys()) {
         agents[name] = this.createAgent(name as AgentName);
      }
      return agents;
   }

   getAvailableAgentNames(): string[] {
      return Array.from(this.agentConfigs.keys());
   }
}

class McpAgent extends AbstractAgent {
   private config: AgentConfig;

   constructor(config: AgentConfig) {
      super();
      this.config = config;
   }

   getName(): AgentName {
      return this.config.name;
   }

   getInstrumentation() {
      return this.config.instrumentation;
   }

   getSystemPrompt(): string | undefined {
      return this.config.systemPrompt;
   }

   getToolSystemPrompt(): string | undefined {
      return this.config.toolSystemPrompt;
   }

   getAssistantPrompt(): string | undefined {
      return this.config.assistantPrompt;
   }

   getUserPrompt(question: string): string {
      if (this.config.userPromptTemplate) {
         return this.config.userPromptTemplate(question);
      }
      return super.getUserPrompt(question);
   }

   shouldValidate(): boolean {
      return this.config.validateData || false;
   }

   async validate(data?: any): Promise<boolean> {
      if (this.config.validator) {
         return await this.config.validator(data);
      }
      return false;
   }
}