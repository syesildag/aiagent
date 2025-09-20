import { AgentName } from '../agent';
import AbstractAgent from './abstractAgent';

/**
 * Simple general-purpose agent class that has access to all MCP servers.
 * This agent provides broad capabilities across all available tools and services.
 */
export class GeneralAgent extends AbstractAgent {
   constructor(private name: AgentName) {
      super();
   }

   getName(): AgentName {
      return this.name;
   }

   getSystemPrompt(): string {
      return `You are a helpful AI assistant. You have access to various tools and capabilities through the MCP (Model Context Protocol) system.`;
   }

   getServerNames(): string[] | undefined {
      return undefined; // General agent uses all available servers
   }
}