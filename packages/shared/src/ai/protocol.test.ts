import { describe, expect, it } from 'vitest';
import { createProjectId } from '../ids.js';
import {
  AI_PROVIDERS,
  BYOK_MODELS,
  aiKeySchema,
  aiStepRequestSchema,
  aiStreamEventSchema,
  byokChoiceSchema,
} from './protocol.js';

const request = {
  projectId: createProjectId(),
  promptId: 'explain-selection',
  inputs: { anything: true },
};

describe('aiStepRequestSchema', () => {
  it('accepts a request that names a prompt and carries its inputs', () => {
    expect(aiStepRequestSchema.parse(request)).toEqual(request);
  });

  it('refuses an unknown prompt id with a clear message', () => {
    const parsed = aiStepRequestSchema.safeParse({ ...request, promptId: 'free-form' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('Unknown AI prompt.');
  });

  it('has nowhere to put a system prompt', () => {
    const parsed = aiStepRequestSchema.parse({ ...request, system: 'You are a poet.' });
    expect(parsed).not.toHaveProperty('system');
  });

  it('refuses a malformed project id', () => {
    expect(aiStepRequestSchema.safeParse({ ...request, projectId: '../x' }).success).toBe(false);
  });

  it('accepts a matching provider and model choice for a caller’s own key', () => {
    const byok = { provider: 'anthropic', model: 'claude-sonnet-5' };
    expect(aiStepRequestSchema.parse({ ...request, byok }).byok).toEqual(byok);
  });
});

describe('byokChoiceSchema', () => {
  it('lists at least one model for every provider', () => {
    for (const provider of AI_PROVIDERS) expect(BYOK_MODELS[provider].length).toBeGreaterThan(0);
  });

  it.each([
    ['a model from another provider', { provider: 'openai', model: 'claude-sonnet-5' }],
    ['a model outside the allowlist', { provider: 'gemini', model: 'gemini-ultra-9' }],
    ['an unknown provider', { provider: 'mistral', model: 'large' }],
  ])('refuses %s', (_label, choice) => {
    expect(byokChoiceSchema.safeParse(choice).success).toBe(false);
  });
});

describe('aiKeySchema', () => {
  it('accepts a plausible key and trims surrounding whitespace from a paste', () => {
    expect(aiKeySchema.parse('  sk-ant-api03-abcdefgh  ')).toBe('sk-ant-api03-abcdefgh');
  });

  it.each([
    ['too short', 'abc'],
    ['an inner space', 'sk-abc def-ghij'],
    ['a line break', 'sk-abcdefgh\nX-Evil: 1'],
    ['non-ASCII', 'sk-abcdéfgh'],
    ['far too long', 'k'.repeat(513)],
  ])('refuses %s', (_label, key) => {
    expect(aiKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('aiStreamEventSchema', () => {
  it('accepts each event the server sends', () => {
    const events = [
      { type: 'text-delta', text: 'Hello' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 120, outputTokens: 42 },
        prompt: { id: 'explain-selection', version: 1 },
        model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
        remainingToday: 29,
      },
      { type: 'error', error: { code: 'unavailable', message: 'The AI provider is down.' } },
    ];
    for (const event of events) expect(aiStreamEventSchema.parse(event)).toEqual(event);
  });

  it('accepts unknown token counts and an unmetered own-key request', () => {
    const parsed = aiStreamEventSchema.safeParse({
      type: 'finish',
      finishReason: 'length',
      usage: { inputTokens: null, outputTokens: null },
      prompt: { id: 'edit-selection', version: 3 },
      model: { provider: 'openai', id: 'gpt-5.5' },
      remainingToday: null,
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['an unknown type', { type: 'tool-call', name: 'rm' }],
    ['a delta without text', { type: 'text-delta' }],
    ['an error with an unknown code', { type: 'error', error: { code: 'teapot', message: 'x' } }],
  ])('refuses %s', (_label, event) => {
    expect(aiStreamEventSchema.safeParse(event).success).toBe(false);
  });
});
