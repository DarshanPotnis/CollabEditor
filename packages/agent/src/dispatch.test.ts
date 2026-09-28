import { describe, expect, it } from 'vitest';
import { dispatchToolCall, parseToolCall } from './dispatch.js';
import { MAX_TOOL_OUTPUT_CHARS } from './limits.js';
import { toolCall } from './scripted-model.js';
import { neverStopped, recordingHost } from './test/support.js';
import { STACK_TRACE_NOTE } from './tool-output.js';

const trace = 'Error: boom\n    at file:///home/project/routes/users.js:30:11';

function dispatch(part: ReturnType<typeof toolCall>, output: string) {
  return dispatchToolCall(part, {
    host: recordingHost(() => ({ ok: true, output })),
    signal: neverStopped,
    finishReason: 'tool-calls',
    onCrash: () => undefined,
  });
}

describe('parseToolCall', () => {
  it('returns a validated call', () => {
    expect(
      parseToolCall({ toolName: 'read_file', input: { path: 'a.js', startLine: 2 } }, 'stop'),
    ).toEqual({
      ok: true,
      call: { name: 'read_file', input: { path: 'a.js', startLine: 2 } },
    });
  });

  it('explains input that is not an object, such as JSON the model mangled', () => {
    const parsed = parseToolCall({ toolName: 'edit_file', input: '{"path": "a.js",' }, 'stop');
    expect(parsed.ok || parsed.message).toMatch(/^The input for edit_file is not valid: input: /);
  });

  it('names at most three problems', () => {
    const parsed = parseToolCall(
      { toolName: 'http_request', input: { headers: 'x', body: 1 } },
      'stop',
    );
    expect(parsed.ok || parsed.message.split('; ')).toHaveLength(3);
  });
});

describe('dispatchToolCall', () => {
  it('adds the stack-trace note to output from the running program only', async () => {
    const terminal = await dispatch(toolCall('read_terminal', {}), trace);
    expect(terminal.result.output).toBe(`${trace}\n\n${STACK_TRACE_NOTE}`);
    const file = await dispatch(toolCall('read_file', { path: 'notes.md' }), trace);
    expect(file.result.output).toBe(trace);
  });

  it('caps what a tool returns', async () => {
    const { result } = await dispatch(
      toolCall('read_terminal', {}),
      'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 500),
    );
    expect(result.output).toMatch(/…\[truncated 500 characters\]$/);
  });

  it('marks a refused call as an error the model reads', async () => {
    const { result, valid } = await dispatchToolCall(toolCall('read_file', { path: 'x' }, 'c9'), {
      host: recordingHost(() => ({ ok: false, output: 'No such file.' })),
      signal: neverStopped,
      finishReason: 'tool-calls',
      onCrash: () => undefined,
    });
    expect(result).toEqual({
      toolCallId: 'c9',
      toolName: 'read_file',
      isError: true,
      output: 'No such file.',
    });
    expect(valid).toBe(true);
  });

  it('never hands finish to the ToolHost', async () => {
    const host = recordingHost();
    const { valid } = await dispatchToolCall(toolCall('finish', { summary: 'x' }), {
      host,
      signal: neverStopped,
      finishReason: 'tool-calls',
      onCrash: () => undefined,
    });
    expect(valid).toBe(false);
    expect(host.calls).toHaveLength(0);
  });
});
