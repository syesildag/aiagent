import { AgentName } from '../agent';
import { AgentDefinition } from '../utils/agentLoader';
import AbstractAgent from './abstractAgent';

/**
 * An agent whose identity, system prompt, tool restrictions, and optional model
 * override are defined by a Markdown file with YAML frontmatter in
 * .aiagent/agents/ or ~/.aiagent/agents/.
 *
 * File format:
 * ---
 * name: my-agent
 * description: One-sentence description shown to the orchestrator.
 * tools: weather, time    # MCP server names (comma/space/array); omit for all
 * model: sonnet           # optional model override
 * ---
 *
 * Your system prompt goes here.
 */
export class FileBasedAgent extends AbstractAgent {
  private readonly definition: AgentDefinition;

  constructor(definition: AgentDefinition) {
    super();
    this.definition = definition;
  }

  getName(): AgentName {
    return this.definition.name;
  }

  getSystemPrompt(): string {
    return this.definition.systemPrompt;
  }

  getDescription(): string {
    return this.definition.description ?? `${this.definition.name} agent`;
  }

  getAllowedServerNames(): string[] | undefined {
    return this.definition.allowedServerNames;
  }

  getModelOverride(): string | undefined {
    return this.definition.model;
  }
}
