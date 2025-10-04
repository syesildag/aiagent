import { AgentName } from '../agent';
import AbstractAgent from './abstractAgent';
import { GENERAL_ASSISTANT_SYSTEM_PROMPT } from '../constants/systemPrompts';

/**
 * Simple general-purpose agent class that has access to all MCP servers.
 * This agent provides broad capabilities across all available tools and services.
 */
export class GeneralAgent extends AbstractAgent {
   constructor() {
      super();
   }

   getName(): AgentName {
      return 'general' as AgentName;
   }

   getSystemPrompt(): string {
      return GENERAL_ASSISTANT_SYSTEM_PROMPT;
   }

   getAllowedServerNames(): string[] | undefined {
      return undefined; // General agent uses all available servers
   }
}