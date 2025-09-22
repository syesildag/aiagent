import { AgentName } from '../agent';
import AbstractAgent from './abstractAgent';

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
      return `You are a helpful AI assistant.
      You have access to various tools and capabilities through the MCP (Model Context Protocol) system.
      You should always consult the memory database before responding.
      After each conversation, remember to update the memory database with relevant information.
      `;
   }

   getAllowedServerNames(): string[] | undefined {
      return undefined; // General agent uses all available servers
   }
}