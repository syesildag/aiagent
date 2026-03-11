import * as path from 'path';
import { SlashCommand, loadSlashCommands } from './slashCommands';
import { Skill, loadSkills } from './skillLoader';

const DEFAULT_COMMANDS_DIR = path.resolve(process.cwd(), '.claude', 'commands');
const DEFAULT_SKILLS_DIR = path.resolve(process.cwd(), '.claude', 'skills');

/** Hardcoded CLI built-in command names that must NOT be shadowed by .md files */
const BUILTIN_COMMANDS = new Set([
  'help', 'login', 'model', 'status', 'refresh',
  'new', 'newchat', 'history', 'current', 'clearchat',
  'cancel', 'clear', 'exit', 'quit',
  'compact',
]);

export class SlashCommandRegistry {
  private commands: Map<string, SlashCommand> = new Map();
  private skills: Map<string, Skill> = new Map();
  private initialized = false;

  private readonly commandsDir: string;
  private readonly skillsDir: string;

  constructor(commandsDir?: string, skillsDir?: string) {
    this.commandsDir = commandsDir ?? DEFAULT_COMMANDS_DIR;
    this.skillsDir = skillsDir ?? DEFAULT_SKILLS_DIR;
  }

  /** Lazy-initialize on first use. Safe to call multiple times. */
  initialize(): void {
    if (this.initialized) return;
    this.commands = loadSlashCommands(this.commandsDir);
    this.skills = loadSkills(this.skillsDir);
    this.initialized = true;
  }

  /** Force-reload commands and skills from disk. */
  reload(): void {
    this.initialized = false;
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
   * Returns a `<skills>…</skills>` block containing all skill contents,
   * suitable for appending to an agent's system prompt (auto-inject).
   * Returns empty string when no skills are loaded.
   */
  getSkillsSystemPromptBlock(): string {
    if (this.skills.size === 0) return '';

    const parts: string[] = ['<skills>'];
    for (const skill of this.skills.values()) {
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
