import { describe, expect, it } from 'vitest';
import type { AiFinish } from './ai-client.js';
import { describeStep, finishNote, keyStatus, settingsAction, usageLine } from './ai-messages.js';

const selection = { path: 'routes/users.js', language: 'javascript', startLine: 12 };

function finish(overrides: Partial<AiFinish> = {}): AiFinish {
  return {
    type: 'finish',
    finishReason: 'stop',
    usage: { inputTokens: 200, outputTokens: 80 },
    prompt: { id: 'explain-selection', version: 1 },
    model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
    remainingToday: 28,
    ...overrides,
  };
}

describe('describeStep', () => {
  it('names the file and the lines explained', () => {
    const step = {
      projectId: 'p1',
      promptId: 'explain-selection',
      inputs: { ...selection, selection: 'a\nb\nc' },
    } as const;
    expect(describeStep(step)).toBe('Explain routes/users.js, lines 12–14');
  });

  it('does not count the line after a selection of whole lines', () => {
    const step = {
      projectId: 'p1',
      promptId: 'explain-selection',
      inputs: { ...selection, selection: 'a\n' },
    } as const;
    expect(describeStep(step)).toBe('Explain routes/users.js, line 12');
  });

  it('includes the instruction for an edit', () => {
    const step = {
      projectId: 'p1',
      promptId: 'edit-selection',
      inputs: { ...selection, selection: 'x', instruction: '  Return 404 when missing. ' },
    } as const;
    expect(describeStep(step)).toBe('Edit routes/users.js, line 12: Return 404 when missing.');
  });

  it('describes an error explanation', () => {
    const step = {
      projectId: 'p1',
      promptId: 'explain-error',
      inputs: { outcome: 'exited', exitCode: 1, terminalOutput: 'boom' },
    } as const;
    expect(describeStep(step)).toBe('Explain why the run stopped');
  });
});

describe('keyStatus', () => {
  it('says whether the shared tier or an own key is in use, never showing the key', () => {
    expect(keyStatus(null)).toBe('Shared free tier');
    expect(keyStatus({ provider: 'anthropic', model: 'claude-haiku-4-5' })).toBe(
      'Your Anthropic key · claude-haiku-4-5',
    );
  });
});

describe('usageLine', () => {
  it('counts down the free requests left today', () => {
    expect(usageLine(finish())).toBe('gemini-3.5-flash-lite · 28 free requests left today');
    expect(usageLine(finish({ remainingToday: 1 }))).toBe(
      'gemini-3.5-flash-lite · 1 free request left today',
    );
    expect(usageLine(finish({ remainingToday: 0 }))).toBe(
      'gemini-3.5-flash-lite · no free requests left today',
    );
  });

  it('names the provider instead when an own key answered', () => {
    const answered = finish({
      model: { provider: 'openai', id: 'gpt-5.5' },
      remainingToday: null,
    });
    expect(usageLine(answered)).toBe('gpt-5.5 · your OpenAI key');
  });
});

describe('finishNote', () => {
  it('explains an answer that was cut short, and says nothing otherwise', () => {
    expect(finishNote(finish({ finishReason: 'length' }))).toContain('cut off');
    expect(finishNote(finish({ finishReason: 'content-filter' }))).toContain('content filter');
    expect(finishNote(finish())).toBeNull();
  });
});

describe('settingsAction', () => {
  it.each([
    ['quota-exhausted', false, 'Add your own key'],
    ['rate-limited', false, 'Add your own key'],
    ['unavailable', false, 'Add your own key'],
    ['bad-request', false, null],
    ['network', false, null],
    ['rate-limited', true, null],
    ['invalid-key', true, 'Check your key'],
  ] as const)('after %s (own key: %s) offers %s', (code, usingOwnKey, label) => {
    expect(settingsAction({ code, message: 'x' }, usingOwnKey)).toBe(label);
  });
});
