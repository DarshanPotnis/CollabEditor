import { describe, expect, it } from 'vitest';
import { sharedModelsFor } from './shared-models.js';

const tier = { model: 'gemini-3.5-flash-lite', fallbackModel: 'gemini-3.1-flash-lite' };
const start = { pinned: undefined, midSession: false };

describe('sharedModelsFor', () => {
  it('tries the default, then the fallback, for a helper or a first step', () => {
    expect(sharedModelsFor(tier, start)).toEqual({
      ok: true,
      models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    });
  });

  it('has only the default when no fallback is configured', () => {
    for (const fallbackModel of [null, undefined]) {
      expect(sharedModelsFor({ model: tier.model, fallbackModel }, start)).toEqual({
        ok: true,
        models: ['gemini-3.5-flash-lite'],
      });
    }
  });

  it('keeps a session on the model it started on, the fallback included', () => {
    expect(sharedModelsFor(tier, { pinned: tier.fallbackModel, midSession: true })).toEqual({
      ok: true,
      models: ['gemini-3.1-flash-lite'],
    });
    expect(sharedModelsFor(tier, { pinned: tier.model, midSession: true })).toEqual({
      ok: true,
      models: ['gemini-3.5-flash-lite'],
    });
  });

  it('never falls back part way through a session', () => {
    expect(sharedModelsFor(tier, { pinned: undefined, midSession: true })).toEqual({
      ok: true,
      models: ['gemini-3.5-flash-lite'],
    });
  });

  it('refuses a model that is not one of the shared tier’s, such as after a config change', () => {
    const choice = sharedModelsFor(tier, { pinned: 'gemini-3.1-pro-preview', midSession: true });
    expect(choice.ok).toBe(false);
    expect(choice.ok || choice.message).toMatch(/Start a new session/);
  });
});
