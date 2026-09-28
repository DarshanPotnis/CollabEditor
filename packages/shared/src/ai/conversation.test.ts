import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_LIMITS,
  conversationChars,
  conversationSchema,
  conversationSteps,
} from './conversation.js';

const signature = { google: { thoughtSignature: 'c2lnbmF0dXJl' } };

function call(toolCallId: string, toolName = 'read_file', input: unknown = { path: 'a.js' }) {
  return { type: 'tool-call', toolCallId, toolName, input };
}

function assistant(...parts: unknown[]) {
  return { role: 'assistant', parts };
}

function results(...calls: Array<[string, string]>) {
  return {
    role: 'tool',
    results: calls.map(([toolCallId, toolName]) => ({
      toolCallId,
      toolName,
      isError: false,
      output: 'ok',
    })),
  };
}

const nudge = { role: 'nudge' };

function problem(entries: unknown[]): string | undefined {
  return conversationSchema.safeParse(entries).error?.issues[0]?.message;
}

describe('conversationSchema', () => {
  it('accepts the empty conversation of a first step', () => {
    expect(conversationSchema.parse([])).toEqual([]);
  });

  it('accepts a real exchange and keeps providerOptions exactly as they were', () => {
    const entries = [
      assistant(
        { type: 'text', text: 'Reading it.' },
        { ...call('c1'), providerOptions: signature },
      ),
      results(['c1', 'read_file']),
      assistant(call('c2', 'edit_file', { path: 'a.js', oldText: 'a', newText: 'b' }), call('c3')),
      results(['c3', 'read_file'], ['c2', 'edit_file']),
      assistant(
        { type: 'reasoning', text: '', providerOptions: signature },
        { type: 'text', text: 'Hm.' },
      ),
      nudge,
    ];
    expect(conversationSchema.parse(entries)).toEqual(entries);
  });

  it('accepts a call to a tool that does not exist, since it still needs an answer', () => {
    const entries = [
      assistant(call('c1', 'hack_the_planet', 'not json')),
      results(['c1', 'hack_the_planet']),
    ];
    expect(conversationSchema.safeParse(entries).success).toBe(true);
  });

  it.each([
    ['results before any answer', [results(['c1', 'read_file'])]],
    ['two answers in a row', [assistant(call('c1')), assistant(call('c2'))]],
    ['a nudge after tool calls', [assistant(call('c1')), nudge]],
    [
      'results after a text-only answer',
      [assistant({ type: 'text', text: 'hi' }), results(['c1', 'read_file'])],
    ],
  ])('refuses %s', (_label, entries) => {
    expect(problem(entries)).toBe('The conversation is out of order.');
  });

  it('refuses results that do not answer exactly the calls made', () => {
    const answer = assistant(call('c1'), call('c2', 'list_files', {}));
    expect(problem([answer, results(['c1', 'read_file'])])).toBe('A tool call has no result.');
    expect(problem([answer, results(['c1', 'read_file'], ['c2', 'read_file'])])).toBe(
      'A tool result does not match a tool call.',
    );
    expect(
      problem([answer, results(['c1', 'read_file'], ['c1', 'read_file'], ['c2', 'list_files'])]),
    ).toBe('A tool result does not match a tool call.');
  });

  it('refuses two calls with the same id', () => {
    expect(problem([assistant(call('c1'), call('c1')), results(['c1', 'read_file'])])).toBe(
      'Two tool calls share an id.',
    );
  });

  it('refuses a conversation that ends before the model can answer', () => {
    expect(problem([assistant(call('c1'))])).toBe(
      'The conversation ends before the model can answer.',
    );
    expect(problem([assistant({ type: 'text', text: 'done?' })])).toBe(
      'The conversation ends before the model can answer.',
    );
  });

  it('refuses providerOptions and tool inputs that are not plain JSON within limits', () => {
    let deep: unknown = 'x';
    for (let depth = 0; depth < 20; depth += 1) deep = [deep];
    const tooBig = { google: { blob: 'x'.repeat(CONVERSATION_LIMITS.providerOptionsChars) } };
    const cases: unknown[] = [
      { ...call('c1'), providerOptions: { google: { nested: deep } } },
      { ...call('c1'), providerOptions: tooBig },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'read_file' },
      call('c1', 'read_file', { n: Number.NaN }),
    ];
    for (const part of cases) {
      expect(
        conversationSchema.safeParse([assistant(part), results(['c1', 'read_file'])]).success,
      ).toBe(false);
    }
  });

  it('refuses a conversation over the character cap, and says what the cap is', () => {
    const long = {
      role: 'tool',
      results: [
        { toolCallId: 'c1', toolName: 'read_file', isError: false, output: 'x'.repeat(20_000) },
      ],
    };
    const entries: unknown[] = [];
    for (let step = 0; step < 7; step += 1) entries.push(assistant(call('c1')), long);
    expect(problem(entries)).toBe(
      'The conversation is too long for the AI (at most 120,000 characters).',
    );
  });
});

describe('conversation measures', () => {
  const entries = conversationSchema.parse([
    assistant(
      { type: 'text', text: 'abc', providerOptions: signature },
      call('c1', 'read_file', { path: 'a.js' }),
    ),
    results(['c1', 'read_file']),
    assistant({ type: 'text', text: 'hello' }),
    nudge,
  ]);

  it('counts one step per model answer', () => {
    expect(conversationSteps(entries)).toBe(2);
  });

  it('counts the characters the model reads, not the opaque providerOptions', () => {
    expect(conversationChars(entries)).toBe(3 + '{"path":"a.js"}'.length + 'ok'.length + 5);
  });
});
