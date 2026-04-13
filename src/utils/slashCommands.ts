/**
 * SlashCommand interface — used by commandProcessor.ts and slashCommandRegistry.ts.
 * Commands are now loaded from .aiagent/skills/ via skillLoader.ts.
 */
export interface SlashCommand {
  /** Derived name, e.g. "commit" or "git:commit" */
  name: string;
  /** Absolute path to the SKILL.md file */
  filePath: string;
  /** From `description:` frontmatter */
  description?: string;
  /** From `argument-hint:` frontmatter */
  argumentHint?: string;
  /**
   * From `allowed-tools:` frontmatter.
   * Values are server-name prefixes (e.g. "memory", "weather") or "*" for all.
   */
  allowedTools?: string[];
  /** From `model:` frontmatter */
  model?: string;
  /** From `disable-model-invocation:` frontmatter */
  disableModelInvocation?: boolean;
  /**
   * From `max-iterations:` frontmatter.
   * Overrides the global MAX_LLM_ITERATIONS setting for this command.
   */
  maxIterations?: number;
  /**
   * From `fresh-context:` frontmatter.
   * When true, the LLM call uses only the current message — prior conversation
   * history is not injected.
   */
  freshContext?: boolean;
  /** Raw Markdown body after the YAML frontmatter */
  body: string;
}
