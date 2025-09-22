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
      Use these tools to assist users with a wide range of tasks, providing accurate and relevant information.
      `;
   }

   getAllowedServerNames(): string[] | undefined {
      return undefined; // General agent uses all available servers
   }
}