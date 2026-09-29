import type { AgentTrace, TraceToolCall } from '@collabcode/agent';
import { describe, expect, it } from 'vitest';
import { replayDifferences, resultLine } from './replay-diff.js';

function call(toolName: string, output: string, isError = false): TraceToolCall {
  return { toolCallId: 'c', toolName, input: {}, isError, output, startedAtMs: 0, durationMs: 0 };
}

function traceOf(...steps: TraceToolCall[][]): AgentTrace {
  return {
    steps: steps.map((toolCalls, index) => ({ index: index + 1, toolCalls })),
  } as unknown as AgentTrace;
}

describe('replay differences', () => {
  it('reads a result by whether it failed and its first line, timings masked', () => {
    expect(resultLine(false, 'HTTP 200 OK, 38 ms\ncontent-type: x')).toBe('ok: HTTP 200 OK, … ms');
    expect(resultLine(true, 'npm test exited with code 1 after 2.4 s.\n...')).toBe(
      'error: npm test exited with code 1 after … s.',
    );
  });

  it('lists only the calls whose result changed, and calls one side did not make', () => {
    const recorded = traceOf(
      [call('edit_file', 'The text to replace is not in the file.', true)],
      [call('http_request', 'HTTP 404 Not Found, 41 ms')],
    );
    const replayed = traceOf(
      [call('edit_file', 'Edited routes/users.js (changed lines 23–38).')],
      [call('http_request', 'HTTP 404 Not Found, 12 ms')],
      [call('finish', '')],
    );
    expect(replayDifferences(recorded, replayed)).toEqual([
      {
        step: 1,
        tool: 'edit_file',
        recorded: 'error: The text to replace is not in the file.',
        replayed: 'ok: Edited routes/users.js (changed lines 23–38).',
      },
      { step: 3, tool: 'finish', recorded: '(not made)', replayed: 'ok: ' },
    ]);
  });
});
