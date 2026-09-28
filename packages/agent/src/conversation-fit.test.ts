import type { ConversationEntry } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import { elidedOutput, fitConversation } from './conversation-fit.js';

function exchange(id: string, output: string): ConversationEntry[] {
  return [
    {
      role: 'assistant',
      parts: [{ type: 'tool-call', toolCallId: id, toolName: 'read_file', input: { path: 'a' } }],
    },
    { role: 'tool', results: [{ toolCallId: id, toolName: 'read_file', isError: false, output }] },
  ];
}

const outputsOf = (entries: readonly ConversationEntry[]): string[] =>
  entries.flatMap((entry) => (entry.role === 'tool' ? entry.results.map((r) => r.output) : []));

describe('fitConversation', () => {
  const conversation = [
    ...exchange('a', 'x'.repeat(500)),
    ...exchange('b', 'y'.repeat(500)),
    ...exchange('c', 'z'.repeat(500)),
  ];

  it('leaves a conversation under the cap as it is', () => {
    expect(fitConversation(conversation, 10_000)).toEqual(conversation);
  });

  it('removes the oldest outputs first, only as many as needed', () => {
    const fitted = fitConversation(conversation, 1_200);
    expect(outputsOf(fitted ?? [])).toEqual([elidedOutput(500), 'y'.repeat(500), 'z'.repeat(500)]);
  });

  it('never changes the model’s messages or the latest output', () => {
    const fitted = fitConversation(conversation, 700) ?? [];
    expect(fitted.filter((entry) => entry.role === 'assistant')).toEqual(
      conversation.filter((entry) => entry.role === 'assistant'),
    );
    expect(outputsOf(fitted).at(-1)).toBe('z'.repeat(500));
  });

  it('says it cannot fit when the latest output alone is too much', () => {
    expect(fitConversation(conversation, 400)).toBeNull();
  });

  it('keeps the original size in an output removed on an earlier step', () => {
    const once = fitConversation(conversation, 1_200) ?? [];
    const twice = fitConversation([...once, ...exchange('d', 'w'.repeat(500))], 800) ?? [];
    expect(outputsOf(twice)[0]).toBe(elidedOutput(500));
  });

  it('does not change the conversation it was given', () => {
    const copy = structuredClone(conversation);
    fitConversation(conversation, 700);
    expect(conversation).toEqual(copy);
  });
});
