import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sessionChanges } from './session-changes.js';
import { parseTrace, type AgentTrace, type TraceToolCall } from './trace.js';

let ids = 0;
function call(toolName: string, input: object, isError = false): TraceToolCall {
  ids += 1;
  return {
    toolCallId: `c${String(ids)}`,
    toolName,
    input,
    isError,
    output: '',
    startedAtMs: 0,
    durationMs: 0,
  };
}

/** A trace whose only content is these tool calls, one step each. */
function traceOf(calls: TraceToolCall[]): AgentTrace {
  return {
    format: 'collabcode-agent-trace',
    version: 3,
    sessionId: 's',
    startedAt: 0,
    project: { template: null, filesFingerprint: 'fp' },
    inputs: { goal: 'g', files: [], moreFiles: 0 },
    prompt: null,
    tier: 'shared',
    limits: {
      maxSteps: 15,
      maxMs: 1,
      maxInputTokens: 1,
      maxToolCallsPerStep: 8,
      maxConversationChars: 1,
    },
    steps: calls.map((toolCall, index) => ({
      index: index + 1,
      startedAtMs: 0,
      waits: [],
      model: null,
      toolCalls: [toolCall],
      nudged: false,
      reminder: null,
    })),
    outcome: null,
    totals: { steps: calls.length, inputTokens: 0, outputTokens: 0, durationMs: 0 },
  };
}

const edit = (path: string) => call('edit_file', { path, oldText: 'a', newText: 'b' });
const create = (path: string) => call('create_file', { path, content: '' });
const remove = (path: string) => call('delete_file', { path });
const rename = (path: string, newPath: string) => call('rename_file', { path, newPath });

describe('sessionChanges', () => {
  it('lists each file once, by what happened to it', () => {
    expect(
      sessionChanges(
        traceOf([
          edit('a.js'),
          edit('./a.js'),
          create('b.js'),
          remove('c.js'),
          rename('d.js', 'e.js'),
        ]),
      ),
    ).toEqual({
      created: ['b.js'],
      edited: ['a.js'],
      renamed: [{ from: 'd.js', to: 'e.js' }],
      deleted: ['c.js'],
    });
  });

  it('counts only calls that succeeded, and ignores the rest of the tools', () => {
    expect(
      sessionChanges(
        traceOf([
          call('edit_file', { path: 'a.js', oldText: 'x', newText: 'y' }, true),
          call('read_file', { path: 'b.js' }),
          call('run_project', {}),
        ]),
      ),
    ).toEqual({ created: [], edited: [], renamed: [], deleted: [] });
  });

  it('nets out a file created and then deleted, and one deleted and made again', () => {
    expect(sessionChanges(traceOf([create('tmp.js'), edit('tmp.js'), remove('tmp.js')]))).toEqual({
      created: [],
      edited: [],
      renamed: [],
      deleted: [],
    });
    expect(sessionChanges(traceOf([remove('a.js'), create('a.js')]))).toEqual({
      created: [],
      edited: ['a.js'],
      renamed: [],
      deleted: [],
    });
  });

  it('follows files through renames, of their own or of their folder', () => {
    expect(
      sessionChanges(
        traceOf([edit('a.js'), rename('a.js', 'b.js'), create('lib/x.js'), rename('lib', 'src')]),
      ),
    ).toEqual({
      created: ['src/x.js'],
      edited: ['b.js'],
      renamed: [
        { from: 'a.js', to: 'b.js' },
        { from: 'lib', to: 'src' },
      ],
      deleted: [],
    });
  });

  it('deletes what it knows is inside a deleted folder, and the folder itself', () => {
    expect(
      sessionChanges(traceOf([edit('lib/a.js'), create('lib/new.js'), remove('lib')])),
    ).toEqual({ created: [], edited: [], renamed: [], deleted: ['lib/a.js', 'lib'] });
  });

  it('reads the recorded session that ran out of steps as its net change', () => {
    const raw: unknown = JSON.parse(
      readFileSync(
        new URL('../fixtures/traces/runtime-unavailable-agent-loops.json', import.meta.url),
        'utf8',
      ),
    );
    const trace = parseTrace(raw);
    if (!trace) throw new Error('the fixture is a trace');
    expect(sessionChanges(trace)).toEqual({
      created: ['test/users.test.js'],
      edited: ['index.js', 'routes/users.js', 'package.json'],
      renamed: [],
      deleted: [],
    });
  });
});
