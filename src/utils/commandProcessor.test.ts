import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { processCommand, toolMatchesPattern, filterToolsByPatterns } from './commandProcessor';
import { SlashCommand } from './slashCommands';
import { Skill } from './skillLoader';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeCommand(body: string, overrides: Partial<SlashCommand> = {}): SlashCommand {
  return {
    name: 'test',
    filePath: '/fake/test.md',
    body,
    ...overrides,
  };
}

function makeSkill(name: string, content: string): Skill {
  return { name, content, filePath: `/fake/skills/${name}/SKILL.md`, description: name, injectable: true };
}

// ── Argument substitution ─────────────────────────────────────────────────────

describe('processCommand — argument substitution', () => {
  const skills = new Map<string, Skill>();

  it('substitutes $1 with first argument', () => {
    const cmd = makeCommand('Review $1 carefully.');
    expect(processCommand(cmd, ['src/index.ts'], skills)).toBe('Review src/index.ts carefully.');
  });

  it('substitutes multiple positional args', () => {
    const cmd = makeCommand('Deploy $1 to $2.');
    expect(processCommand(cmd, ['app', 'staging'], skills)).toBe('Deploy app to staging.');
  });

  it('replaces $ARGUMENTS with all args joined', () => {
    const cmd = makeCommand('Fix issue #$ARGUMENTS.');
    expect(processCommand(cmd, ['42'], skills)).toBe('Fix issue #42.');
  });

  it('replaces $ARGUMENTS with whole string when multiple args', () => {
    const cmd = makeCommand('Do $ARGUMENTS now.');
    expect(processCommand(cmd, ['a', 'b', 'c'], skills)).toBe('Do a b c now.');
  });

  it('replaces with empty string when arg index out of range', () => {
    const cmd = makeCommand('Hello $1 and $2.');
    expect(processCommand(cmd, ['world'], skills)).toBe('Hello world and .');
  });
});

// ── Conditional blocks ($IF / $ELSE / $ENDIF) ─────────────────────────────────

describe('processCommand — conditional blocks', () => {
  const skills = new Map<string, Skill>();

  it('keeps true branch when $1 is provided', () => {
    const body = 'Before\n$IF $1\nTrue branch\n$ELSE\nFalse branch\n$ENDIF\nAfter';
    const cmd = makeCommand(body);
    const result = processCommand(cmd, ['london'], skills);
    expect(result).toContain('True branch');
    expect(result).not.toContain('False branch');
    expect(result).not.toContain('$IF');
    expect(result).not.toContain('$ELSE');
    expect(result).not.toContain('$ENDIF');
  });

  it('keeps false branch when $1 is empty', () => {
    const body = 'Before\n$IF $1\nTrue branch\n$ELSE\nFalse branch\n$ENDIF\nAfter';
    const cmd = makeCommand(body);
    const result = processCommand(cmd, [], skills);
    expect(result).toContain('False branch');
    expect(result).not.toContain('True branch');
  });

  it('removes entire block when condition empty and no $ELSE', () => {
    const body = 'Before\n$IF $1\nOnly if set\n$ENDIF\nAfter';
    const cmd = makeCommand(body);
    const result = processCommand(cmd, [], skills);
    expect(result).not.toContain('Only if set');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('substitutes $1 inside true branch before evaluation', () => {
    const body = '$IF $1\nLocation: $1\n$ELSE\nNo location\n$ENDIF';
    const cmd = makeCommand(body);
    const result = processCommand(cmd, ['paris'], skills);
    expect(result).toContain('Location: paris');
  });
});

// ── File inclusion ─────────────────────────────────────────────────────────────

describe('processCommand — file inclusion', () => {
  let tmpDir: string;
  const skills = new Map<string, Skill>();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replaces @path with file content', () => {
    const filePath = path.join(tmpDir, 'hello.txt');
    fs.writeFileSync(filePath, 'file content here');
    const cmd = makeCommand(`Review @${filePath}`);
    expect(processCommand(cmd, [], skills)).toBe('Review file content here');
  });

  it('leaves @path unchanged when file does not exist', () => {
    const cmd = makeCommand('Review @/nonexistent/file.ts');
    expect(processCommand(cmd, [], skills)).toBe('Review @/nonexistent/file.ts');
  });
});

// ── Bash execution ─────────────────────────────────────────────────────────────

describe('processCommand — bash execution', () => {
  const skills = new Map<string, Skill>();

  it('replaces !`command` with stdout', () => {
    const cmd = makeCommand('Date: !`echo hello`');
    expect(processCommand(cmd, [], skills)).toBe('Date: hello');
  });

  it('handles failed commands gracefully', () => {
    const cmd = makeCommand('Result: !`exit 1`');
    const result = processCommand(cmd, [], skills);
    expect(result).toContain('Result:');
    expect(result).toContain('[bash error:');
  });
});

// ── Skill injection ────────────────────────────────────────────────────────────

describe('processCommand — skill injection', () => {
  const codeStandards = makeSkill('code-standards', '## Type safety\nAlways use strict types.');

  it('appends skill content when referenced in body', () => {
    const skills = new Map([['code-standards', codeStandards]]);
    const cmd = makeCommand('Use the code-standards skill to validate.');
    const result = processCommand(cmd, [], skills);
    expect(result).toContain('## Skill: code-standards');
    expect(result).toContain('Always use strict types.');
  });

  it('does not append skill when not referenced', () => {
    const skills = new Map([['code-standards', codeStandards]]);
    const cmd = makeCommand('Just do something.');
    const result = processCommand(cmd, [], skills);
    expect(result).not.toContain('## Skill:');
  });

  it('does not duplicate skills referenced multiple times', () => {
    const skills = new Map([['code-standards', codeStandards]]);
    const cmd = makeCommand('Use the code-standards skill here. Also: use the code-standards skill again.');
    const result = processCommand(cmd, [], skills);
    const count = (result.match(/## Skill: code-standards/g) || []).length;
    expect(count).toBe(1);
  });
});

// ── toolMatchesPattern ─────────────────────────────────────────────────────────

describe('toolMatchesPattern', () => {
  it('matches wildcard *', () => {
    expect(toolMatchesPattern('memory_mcreate', '*')).toBe(true);
  });

  it('matches exact tool name', () => {
    expect(toolMatchesPattern('memory_mcreate', 'memory_mcreate')).toBe(true);
    expect(toolMatchesPattern('memory_msearch', 'memory_msearch')).toBe(true);
  });

  it('matches server-name prefix', () => {
    expect(toolMatchesPattern('memory_mcreate', 'memory')).toBe(true);
    expect(toolMatchesPattern('memory_msearch', 'memory')).toBe(true);
  });

  it('does not match unrelated tool', () => {
    expect(toolMatchesPattern('weather_get_current', 'memory')).toBe(false);
  });

  it('does not confuse partial prefix', () => {
    // "mem" should NOT match "memory_mcreate"
    expect(toolMatchesPattern('memory_create', 'mem')).toBe(false);
  });
});

// ── filterToolsByPatterns ──────────────────────────────────────────────────────

describe('filterToolsByPatterns', () => {
  const tools = ['memory_mcreate', 'memory_msearch', 'weather_get_current', 'time_get'];

  it('returns all tools when patterns undefined', () => {
    expect(filterToolsByPatterns(tools, undefined)).toEqual(tools);
  });

  it('returns all tools when patterns empty', () => {
    expect(filterToolsByPatterns(tools, [])).toEqual(tools);
  });

  it('filters to server prefix', () => {
    expect(filterToolsByPatterns(tools, ['memory'])).toEqual(['memory_mcreate', 'memory_msearch']);
  });

  it('wildcard returns all tools', () => {
    expect(filterToolsByPatterns(tools, ['*'])).toEqual(tools);
  });

  it('multiple patterns union', () => {
    expect(filterToolsByPatterns(tools, ['memory', 'time'])).toEqual([
      'memory_mcreate',
      'memory_msearch',
      'time_get',
    ]);
  });
});
