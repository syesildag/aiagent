import { Options } from 'ollama';
import Instrumentation from './utils/instrumentation';

import DatabaseAgent from './agents/databaseAgent';
import WeatherAgent from './agents/weatherAgent';
import { Session } from './repository/entities/session';

export type AgentName =
"weather" |
"database";

export interface Agent {
   askQuestion(session: Session, question: string): Promise<string>;
   validate(session: Session, data?: any, validate?: string): Promise<boolean>;
   getToolSystemPrompt(): string;
   getSystemPrompt(): string;
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