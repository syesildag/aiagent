import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadSlashCommands, deriveCommandName } from './slashCommands';

// ── deriveCommandName ─────────────────────────────────────────────────────────

describe('deriveCommandName', () => {
  it('returns plain name for top-level file', () => {
    expect(deriveCommandName('commit.md')).toBe('commit');
  });

  it('joins with colon for nested file', () => {
    expect(deriveCommandName('git/commit.md')).toBe('git:commit');
  });

  it('handles multiple nesting levels', () => {
    expect(deriveCommandName('git/push/pr.md')).toBe('git:push:pr');
  });

  it('handles Windows-style separators', () => {
    expect(deriveCommandName('git\\commit.md')).toBe('git:commit');
  });
});

// ── loadSlashCommands ─────────────────────────────────────────────────────────

describe('loadSlashCommands', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty map for non-existent directory', () => {
    const result = loadSlashCommands('/nonexistent/path/commands');
    expect(result.size).toBe(0);
  });

  it('loads a minimal command with no frontmatter', () => {
    fs.writeFileSync(path.join(tmpDir, 'hello.md'), 'Say hello to the user.');
    const result = loadSlashCommands(tmpDir);
    expect(result.has('hello')).toBe(true);
    const cmd = result.get('hello')!;
    expect(cmd.body).toBe('Say hello to the user.');
    expect(cmd.description).toBeUndefined();
  });

  it('parses frontmatter fields correctly', () => {
    const content = `---
description: Create a git commit
argument-hint: "[message]"
allowed-tools: "memory, weather"
model: haiku
disable-model-invocation: true
---
Write a commit.`;
    fs.writeFileSync(path.join(tmpDir, 'commit.md'), content);
    const result = loadSlashCommands(tmpDir);
    const cmd = result.get('commit')!;
    expect(cmd.description).toBe('Create a git commit');
    expect(cmd.argumentHint).toBe('[message]');
    expect(cmd.allowedTools).toEqual(['memory', 'weather']);
    expect(cmd.model).toBe('haiku');
    expect(cmd.disableModelInvocation).toBe(true);
  });

  it('parses array allowed-tools from frontmatter', () => {
    const content = `---
allowed-tools:
  - Read
  - Write
---
Body`;
    fs.writeFileSync(path.join(tmpDir, 'cmd.md'), content);
    const cmd = loadSlashCommands(tmpDir).get('cmd')!;
    expect(cmd.allowedTools).toEqual(['Read', 'Write']);
  });

  it('derives namespaced names for subdirectories', () => {
    const subDir = path.join(tmpDir, 'git');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'push.md'), 'Push branch.');
    const result = loadSlashCommands(tmpDir);
    expect(result.has('git:push')).toBe(true);
  });

  it('skips non-.md files', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'not a command');
    expect(loadSlashCommands(tmpDir).size).toBe(0);
  });
});
