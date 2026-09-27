import { describe, expect, it } from 'vitest';
import { describeFailure, describeWait, sharedTierBusy } from './failure-messages.js';

describe('describeFailure', () => {
  it('tells someone with their own key that their provider refused it', () => {
    expect(describeFailure('invalid-key', 401, 'openai')).toEqual({
      code: 'invalid-key',
      message: 'OpenAI refused your key. Check it in AI settings.',
    });
  });

  it('does not blame the caller when the shared key is refused', () => {
    expect(describeFailure('invalid-key', 403, null).code).toBe('unavailable');
  });

  it('suggests an own key when the shared tier is busy, but not when theirs is', () => {
    expect(describeFailure('rate-limited', 429, null).message).toContain('add your own key');
    expect(describeFailure('rate-limited', 429, 'gemini').message).toBe(
      'Google Gemini is rate limiting your key right now. Wait a moment and try again.',
    );
  });

  it('names the status of a refused request, and the likely cause with an own key', () => {
    expect(describeFailure('rejected', 404, 'anthropic')).toEqual({
      code: 'bad-request',
      message:
        'The AI provider refused this request (HTTP 404). Check that your key can use the model you chose.',
    });
    expect(describeFailure('rejected', null, null).message).toBe(
      'The AI provider refused this request.',
    );
  });

  it('separates a provider that is down from one that is slow', () => {
    expect(describeFailure('unavailable', 503, null).message).toContain('not answering');
    expect(describeFailure('timeout', null, 'gemini').message).toContain('took too long');
  });
});

describe('describeWait', () => {
  it.each([
    [0, 'a few seconds'],
    [5_000, 'a few seconds'],
    [5_001, 'about 10 seconds'],
    [23_000, 'about 25 seconds'],
    [54_000, 'about 55 seconds'],
    [55_000, 'a minute'],
    [60_000, 'a minute'],
  ])('puts %i ms as %s', (ms, words) => {
    expect(describeWait(ms)).toBe(words);
  });
});

describe('sharedTierBusy', () => {
  it('says roughly how long to wait when the wait is known', () => {
    expect(sharedTierBusy(23_000)).toEqual({
      code: 'rate-limited',
      message:
        'The shared free AI is busy right now. Try again in about 25 seconds, or add your own key in AI settings.',
    });
  });

  it("falls back to a minute when the provider's wait is unknown", () => {
    expect(sharedTierBusy(null).message).toContain('Try again in a minute,');
  });
});
