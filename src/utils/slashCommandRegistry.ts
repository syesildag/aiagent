import * as path from 'path';
import matter from 'gray-matter';
import { SlashCommand } from './slashCommands';
import { Skill, loadSkills } from './skillLoader';
import { getEmbeddingService } from './embeddingService';
import Logger from './logger';

const DEFAULT_SKILLS_DIR = path.resolve(process.cwd(), '.claude', 'skills');

/** Hardcoded CLI built-in command names that must NOT be shadowed by .md files */
const BUILTIN_COMMANDS = new Set([
  'help', 'login', 'model', 'status', 'refresh',
  'new', 'newchat', 'history', 'current', 'clearchat',
  'cancel', 'clear', 'exit', 'quit',
]);

export class SlashCommandRegistry {
  private commands: Map<string, SlashCommand> = new Map();
  private skills: Map<string, Skill> = new Map();
  private initialized = false;

  private readonly skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir ?? DEFAULT_SKILLS_DIR;
  }

  /** Lazy-initialize on first use. Safe to call multiple times. */
  initialize(): void {
    if (this.initialized) return;
    this.skills = loadSkills(this.skillsDir);

    // Register skills that have command frontmatter as slash commands
    for (const [skillName, skill] of this.skills) {
      if (!skill.commandMeta) continue;
      const meta = skill.commandMeta;
      this.commands.set(skillName, {
        name: skillName,
        filePath: skill.filePath,
        description: meta.description ?? skill.description,
        argumentHint: meta.argumentHint,
        allowedTools: meta.allowedTools,
        model: meta.model,
        disableModelInvocation: meta.disableModelInvocation ?? false,
        maxIterations: meta.maxIterations,
        freshContext: meta.freshContext ?? false,
        body: matter(skill.content).content.trim(),
      });
    }

    this.initialized = true;
  }

  /** Force-reload commands and skills from disk. */
  reload(): void {
    this.initialized = false;
    this.commands = new Map();
    this.initialize();
  }

  getCommand(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  listCommands(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  getSkills(): Map<string, Skill> {
    return this.skills;
  }

  /**
   * Returns the `<skills>…</skills>` block and the highest `maxIterations` declared
   * across matched skills, for injectable skills semantically similar to `prompt`
   * (cosine similarity ≥ `threshold`).
   * Falls back to all injectable skills if the embedding service is unavailable.
   */
  async getSkillsSystemPromptBlockForPrompt(
    prompt: string,
    threshold = 0.40,
  ): Promise<{ block: string; maxIterations?: number }> {
    const injectableSkills = Array.from(this.skills.values()).filter(s => s.injectable);
    if (injectableSkills.length === 0) return { block: '' };

    try {
      const embeddingService = getEmbeddingService();
      const texts = [prompt, ...injectableSkills.map(s => s.description)];
      const embeddings = await embeddingService.generateBatchEmbeddings(texts);
      const promptEmbedding = embeddings[0];
      const matchedSkills: Skill[] = [];

      for (let i = 0; i < injectableSkills.length; i++) {
        const skill = injectableSkills[i];
        const { similarity } = embeddingService.calculateSimilarity(
          promptEmbedding, embeddings[i + 1], 'cosine',
        );
        Logger.debug(`[Skills] "${skill.name}" similarity=${similarity.toFixed(3)} threshold=${threshold}`);
        if (similarity >= threshold) {
          Logger.info(`[Skills] Loaded "${skill.name}" (similarity=${similarity.toFixed(3)})`);
          matchedSkills.push(skill);
        }
      }

      if (matchedSkills.length === 0) return { block: '' };

      const parts: string[] = ['<skills>'];
      for (const skill of matchedSkills) {
        parts.push(`## ${skill.name}\n\n${skill.content}`);
      }
      parts.push('</skills>');
      const block = parts.join('\n\n');

      // Propagate the highest max-iterations declared across matched skills so
      // the LLM loop budget is not capped at the global default for skill prompts.
      const maxIterations = matchedSkills
        .map(s => s.commandMeta?.maxIterations)
        .filter((n): n is number => n !== undefined)
        .reduce((a, b) => Math.max(a, b), 0) || undefined;

      return { block, maxIterations };

    } catch (error) {
      Logger.warn(`[Skills] Semantic filtering failed (${error instanceof Error ? error.message : String(error)}); falling back to all skills`);
      return { block: this.getSkillsSystemPromptBlock() };
    }
  }

  /**
   * Returns a `<skills>…</skills>` block containing all injectable skill contents,
   * suitable for appending to an agent's system prompt (auto-inject).
   * Returns empty string when no injectable skills are loaded.
   */
  getSkillsSystemPromptBlock(): string {
    const injectableSkills = Array.from(this.skills.values()).filter(s => s.injectable);
    if (injectableSkills.length === 0) return '';

    const parts: string[] = ['<skills>'];
    for (const skill of injectableSkills) {
      parts.push(`## ${skill.name}\n\n${skill.content}`);
    }
    parts.push('</skills>');
    return parts.join('\n\n');
  }

  /**
   * Returns true if `input` starts with `/` and the inferred command name is a
   * registered slash command (and not a CLI built-in).
   */
  hasCommand(input: string): boolean {
    if (!input.startsWith('/')) return false;
    const name = input.slice(1).split(/\s+/)[0];
    if (BUILTIN_COMMANDS.has(name.toLowerCase())) return false;
    return this.commands.has(name);
  }

  /**
   * Parse a slash-command input string, e.g. "/git:commit arg1 arg2".
   * Returns `{ name, args }` or `null` if not a slash command.
   */
  parseInput(input: string): { name: string; args: string[] } | null {
    if (!input.startsWith('/')) return null;
    const parts = input.slice(1).split(/\s+/);
    const name = parts[0];
    if (!name) return null;
    return { name, args: parts.slice(1) };
  }
}

/** Module-level singleton — shared by CLI and web server. */
export const slashCommandRegistry = new SlashCommandRegistry();
