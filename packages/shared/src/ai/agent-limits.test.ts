import { describe, expect, it } from 'vitest';
import { AGENT_STEP_LIMITS, stepsLeftFor } from './agent-limits.js';
import type { ConversationEntry } from './conversation.js';

/** `steps` model answers, each a list_files call and its result. */
function conversationOf(steps: number): ConversationEntry[] {
  return Array.from({ length: steps }, (_, index): ConversationEntry[] => [
    {
      role: 'assistant',
      parts: [
        { type: 'tool-call', toolCallId: `c${String(index)}`, toolName: 'list_files', input: {} },
      ],
    },
    {
      role: 'tool',
      results: [
        { toolCallId: `c${String(index)}`, toolName: 'list_files', isError: false, output: '' },
      ],
    },
  ]).flat();
}

describe('stepsLeftFor', () => {
  it("counts the step being asked for, from the tier's cap", () => {
    expect(stepsLeftFor('shared', [])).toBe(AGENT_STEP_LIMITS.shared);
    expect(stepsLeftFor('shared', conversationOf(12))).toBe(3);
    expect(stepsLeftFor('ownKey', conversationOf(12))).toBe(AGENT_STEP_LIMITS.ownKey - 12);
  });
});
