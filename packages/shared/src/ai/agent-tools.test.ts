import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS, AGENT_TOOL_NAMES, isAgentToolName } from './agent-tools.js';
import { declareTools } from './prompt.js';

describe('the agent tools', () => {
  it('are the thirteen AI-2 tools', () => {
    expect(AGENT_TOOL_NAMES).toEqual([
      'list_files',
      'read_file',
      'search_code',
      'edit_file',
      'create_file',
      'rename_file',
      'delete_file',
      'run_project',
      'stop_project',
      'read_terminal',
      'http_request',
      'run_command',
      'finish',
    ]);
  });

  it('are declared as plain JSON Schema objects under names every provider accepts', () => {
    for (const declaration of declareTools(AGENT_TOOLS)) {
      expect(declaration.name).toMatch(/^[a-z_]{1,64}$/);
      expect(declaration.description.length).toBeGreaterThan(10);
      expect(declaration.inputSchema).toMatchObject({ type: 'object' });
      expect(JSON.stringify(declaration.inputSchema)).not.toContain('$ref');
    }
  });

  it('recognise only their own names', () => {
    expect(isAgentToolName('edit_file')).toBe(true);
    for (const name of ['toString', '__proto__', 'constructor', 'purge', '']) {
      expect(isAgentToolName(name)).toBe(false);
    }
  });
});

describe('tool inputs', () => {
  it('read_file refuses a range that ends before it starts', () => {
    const input = AGENT_TOOLS.read_file.input;
    expect(input.safeParse({ path: 'a.js', startLine: 5, endLine: 9 }).success).toBe(true);
    expect(
      input.safeParse({ path: 'a.js', startLine: 9, endLine: 5 }).error?.issues[0]?.message,
    ).toBe('endLine must not be before startLine.');
    expect(input.safeParse({ path: 'a.js', startLine: 0 }).success).toBe(false);
  });

  it('http_request takes only a local path and a known method', () => {
    const input = AGENT_TOOLS.http_request.input;
    expect(
      input.safeParse({
        method: 'DELETE',
        path: '/users/1',
        headers: [{ name: 'content-type', value: 'application/json' }],
        body: '{}',
      }).success,
    ).toBe(true);
    expect(input.safeParse({ method: 'GET', path: 'https://evil.test/' }).success).toBe(false);
    expect(input.safeParse({ method: 'CONNECT', path: '/' }).success).toBe(false);
  });

  it('run_command runs only node or npm', () => {
    const input = AGENT_TOOLS.run_command.input;
    expect(input.safeParse({ command: 'node', args: ['--test'] }).success).toBe(true);
    expect(input.safeParse({ command: 'sh', args: ['-c', 'rm -rf /'] }).success).toBe(false);
  });

  it('finish needs a summary with something in it', () => {
    const input = AGENT_TOOLS.finish.input;
    expect(input.parse({ summary: '  Added the route.  ' })).toEqual({
      summary: 'Added the route.',
    });
    expect(input.safeParse({ summary: '   ' }).success).toBe(false);
  });

  it('finish may list the requests and commands it checked, each with what it got', () => {
    const input = AGENT_TOOLS.finish.input;
    const checked = {
      summary: 'Added it.',
      checkedRequests: [{ method: 'DELETE', path: '/users/abc', status: 400 }],
      checkedCommands: [{ command: 'npm test', exitCode: 0 }],
    };
    expect(input.parse(checked)).toEqual(checked);
    expect(
      input.safeParse({ ...checked, checkedRequests: [{ method: 'GET', path: '/', status: 42 }] })
        .success,
    ).toBe(false);
    expect(
      input.safeParse({ summary: 's', checkedRequests: [{ method: 'GET', path: '/' }] }).success,
    ).toBe(false);
  });
});
