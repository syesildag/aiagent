import * as path from 'path';
import matter from 'gray-matter';
import { SlashCommand } from './slashCommands';
import { Skill, loadSkills } from './skillLoader';
import { getEmbeddingService } from './embeddingService';
import { BM25Index } from './bm25Index';
import Logger from './logger';
import { config } from './config';

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
    threshold = config.EMBEDDING_SIMILARITY_THRESHOLD,
  ): Promise<{ block: string; maxIterations?: number; allowedTools?: string[] }> {
    const injectableSkills = Array.from(this.skills.values()).filter(s => s.injectable);
    if (injectableSkills.length === 0) return { block: '' };

    // Short/generic prompts (e.g. greetings) produce near-centroid embeddings
    // that spuriously match every skill. Skip filtering for them.
    const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < config.EMBEDDING_MIN_PROMPT_WORDS) {
      Logger.debug(`[Skills] Prompt too short (${wordCount} words < ${config.EMBEDDING_MIN_PROMPT_WORDS}); skipping similarity filter`);
      return { block: '' };
    }

    if (config.SKILL_ROUTING_STRATEGY === 'none') {
      return this.buildSkillsResult(injectableSkills);
    }

    if (config.SKILL_ROUTING_STRATEGY === 'tags') {
      const matched = this.filterSkillsByTags(prompt, injectableSkills);
      for (const skill of matched) {
        Logger.info(`[Skills] Loaded "${skill.name}" (tags match)`);
      }
      return this.buildSkillsResult(matched);
    }

    if (config.SKILL_ROUTING_STRATEGY === 'bm25') {
      const matched = this.filterSkillsByBM25(prompt, injectableSkills, threshold);
      for (const skill of matched) {
        Logger.info(`[Skills] Loaded "${skill.name}" (BM25 match)`);
      }
      return this.buildSkillsResult(matched);
    }

    // 'embedding' strategy
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

      return this.buildSkillsResult(matchedSkills);

    } catch (error) {
      Logger.warn(`[Skills] Semantic filtering failed (${error instanceof Error ? error.message : String(error)}); falling back to all skills`);
      return { block: this.getSkillsSystemPromptBlock() };
    }
  }

  /** Builds the result object from a list of matched skills. */
  private buildSkillsResult(
    matchedSkills: Skill[],
  ): { block: string; maxIterations?: number; allowedTools?: string[] } {
    if (matchedSkills.length === 0) return { block: '' };

    const parts: string[] = ['<skills>'];
    for (const skill of matchedSkills) {
      parts.push(`## ${skill.name}\n\n${matter(skill.content).content.trim()}`);
    }
    parts.push('</skills>');
    const block = parts.join('\n\n');

    const maxIterations = matchedSkills
      .map(s => s.commandMeta?.maxIterations)
      .filter((n): n is number => n !== undefined)
      .reduce((a, b) => Math.max(a, b), 0) || undefined;

    const allAllowedTools = matchedSkills.flatMap(s => s.commandMeta?.allowedTools ?? []);
    const allowedTools = allAllowedTools.length > 0 ? [...new Set(allAllowedTools)] : undefined;

    return { block, maxIterations, allowedTools };
  }

  /**
   * Returns skills whose `tags` list contains at least one tag that appears
   * as a substring of `prompt` (case-insensitive). Skills without tags are
   * excluded when the tags strategy is active.
   */
  private filterSkillsByTags(prompt: string, skills: Skill[]): Skill[] {
    const normalized = prompt.toLowerCase();
    return skills.filter(
      skill => skill.tags && skill.tags.length > 0 &&
        skill.tags.some(tag => normalized.includes(tag.toLowerCase())),
    );
  }

  /**
   * Returns skills whose BM25 normalized score against `prompt` meets `threshold`.
   * Scores are normalized to [0, 1] relative to the top-scoring skill.
   */
  private filterSkillsByBM25(prompt: string, skills: Skill[], threshold: number): Skill[] {
    if (skills.length === 0) return [];
    const bm25 = new BM25Index(skills.map(s => s.description));
    const scores = bm25.normalizedScoreAll(prompt);
    return skills.filter((_, i) => scores[i] >= threshold);
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
      parts.push(`## ${skill.name}\n\n${matter(skill.content).content.trim()}`);
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
