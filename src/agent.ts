import { Options } from 'ollama';
import Instrumentation from './utils/instrumentation';

import DatabaseAgent from './agents/databaseAgent';
import WeatherAgent from './agents/weatherAgent';
import { Session } from './repository/entities/session';

export type AgentName =
"weather" |
"database";

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

const Agents: Record<AgentName, Agent> = [
   WeatherAgent,
   DatabaseAgent
].reduce((acc, agent) => {
   acc[agent.getName()] = agent;
   return acc;
} , {} as Record<AgentName, Agent>);

export function getAgentFromName(agentName: string) {
   const agent = Agents[agentName as AgentName];
   if (!agent)
      throw new Error(`Invalid agent selected: ${agentName}`);
   return agent;
}