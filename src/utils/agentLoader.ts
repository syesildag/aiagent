import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import Logger from './logger';

export interface AgentDefinition {
  /** Agent identifier from the `name:` frontmatter field */
  name: string;
  /** From `description:` frontmatter — used in the sub-agent task tool description */
  description?: string;
  /** MCP server names this agent may use; undefined means all servers */
  allowedServerNames?: string[];
  /** MCP server names whose direct tools are hidden from this agent's LLM context */
  excludedServerNames?: string[];
  /** From `model:` frontmatter — overrides the global LLM model for this agent */
  model?: string;
  /** Markdown body after the frontmatter delimiter — used as the system prompt */
  systemPrompt: string;
  /** Absolute path to the source file */
  filePath: string;
}

/**
 * Parse the `tools` frontmatter field into MCP server names.
 * Accepts a comma/space-separated string or a YAML array.
 * Returns undefined when absent (meaning "all servers").
 */
function parseTools(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const result = value.map(String).map(s => s.trim()).filter(Boolean);
    return result.length > 0 ? result : undefined;
  }
  if (typeof value === 'string') {
    const result = value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    return result.length > 0 ? result : undefined;
  }
  return undefined;
}

/**
 * Load all agent definitions from the given directory.
 * Each .md file with a valid `name:` frontmatter field becomes an AgentDefinition.
 * Files without a `name:` are skipped with a warning.
 * Returns an empty Map if the directory does not exist.
 */
export function loadAgentDefinitions(agentsDir: string): Map<string, AgentDefinition> {
  const agents = new Map<string, AgentDefinition>();

  if (!fs.existsSync(agentsDir)) return agents;

  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue;

    const filePath = path.join(agentsDir, entry.name);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data, content } = matter(raw);

      const name = data.name ? String(data.name).trim() : undefined;
      if (!name) {
        Logger.warn(`[AgentLoader] Skipping ${filePath}: missing required "name:" frontmatter field`);
        continue;
      }

      const systemPrompt = content.trim();
      if (!systemPrompt) {
        Logger.warn(`[AgentLoader] Agent "${name}" in ${filePath} has an empty system prompt`);
      }

      agents.set(name, {
        name,
        description: data.description ? String(data.description) : undefined,
        allowedServerNames: parseTools(data.tools),
        excludedServerNames: parseTools(data.forbidden),
        model: data.model ? String(data.model) : undefined,
        systemPrompt,
        filePath,
      });
    } catch (err) {
      Logger.warn(`[AgentLoader] Failed to load ${filePath}: ${err}`);
    }
  }

  return agents;
}
