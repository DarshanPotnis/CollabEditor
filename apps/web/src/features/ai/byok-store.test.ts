import { describe, expect, it } from 'vitest';
import {
  OWN_KEY_STORAGE_KEY,
  changeOwnKeyModel,
  forgetOwnKey,
  loadOwnKey,
  ownKeyChoice,
  saveOwnKey,
  type KeyStorage,
  type OwnKey,
} from './byok-store.js';

const OWN_KEY: OwnKey = {
  choice: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  key: 'sk-ant-test-0123456789',
};

function memoryStorage(initial?: string): KeyStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(OWN_KEY_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const blocked: KeyStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('SecurityError');
  },
  removeItem() {
    throw new Error('SecurityError');
  },
};

describe('saveOwnKey and loadOwnKey', () => {
  it('round-trips a key with its provider and model', () => {
    const storage = memoryStorage();
    expect(saveOwnKey(storage, OWN_KEY)).toEqual({ ok: true, choice: OWN_KEY.choice });
    expect(loadOwnKey(storage)).toEqual(OWN_KEY);
  });

  it('trims the key before keeping it', () => {
    const storage = memoryStorage();
    saveOwnKey(storage, { ...OWN_KEY, key: `  ${OWN_KEY.key}\n` });
    expect(loadOwnKey(storage)?.key).toBe(OWN_KEY.key);
  });

  it.each([
    ['too short', 'abc'],
    ['containing a space', 'sk-ant test-0123456789'],
    ['empty', '   '],
  ])('refuses a key that is %s, and keeps nothing', (_label, key) => {
    const storage = memoryStorage();
    const result = saveOwnKey(storage, { ...OWN_KEY, key });
    expect(result).toEqual({ ok: false, message: "That doesn't look like an API key." });
    expect(storage.values.size).toBe(0);
  });

  it('says so when the browser will not store it', () => {
    expect(saveOwnKey(blocked, OWN_KEY)).toMatchObject({ ok: false });
    expect(saveOwnKey(null, OWN_KEY)).toMatchObject({ ok: false });
  });
});

describe('loadOwnKey', () => {
  it('finds nothing in empty or missing storage', () => {
    expect(loadOwnKey(memoryStorage())).toBeNull();
    expect(loadOwnKey(null)).toBeNull();
    expect(loadOwnKey(blocked)).toBeNull();
  });

  it.each([
    ['broken JSON', '{ not json'],
    [
      'a model outside the allowlist',
      JSON.stringify({ ...OWN_KEY, choice: { provider: 'anthropic', model: 'gpt-5.5' } }),
    ],
    [
      'an unknown provider',
      JSON.stringify({ ...OWN_KEY, choice: { provider: 'acme', model: 'x' } }),
    ],
    ['a key with a line break', JSON.stringify({ ...OWN_KEY, key: 'sk-ant-01234\n56789' })],
    ['a missing key', JSON.stringify({ choice: OWN_KEY.choice })],
  ])('ignores %s', (_label, stored) => {
    expect(loadOwnKey(memoryStorage(stored))).toBeNull();
  });
});

describe('changeOwnKeyModel', () => {
  it("keeps the key when moving to another of its provider's models", () => {
    const storage = memoryStorage();
    saveOwnKey(storage, OWN_KEY);
    const choice = { provider: 'anthropic', model: 'claude-opus-5-5' } as const;
    expect(changeOwnKeyModel(storage, choice)).toEqual({ ok: true, choice });
    expect(loadOwnKey(storage)).toEqual({ choice, key: OWN_KEY.key });
  });

  it('asks for a key when the provider changes, and keeps the old one meanwhile', () => {
    const storage = memoryStorage();
    saveOwnKey(storage, OWN_KEY);
    expect(changeOwnKeyModel(storage, { provider: 'openai', model: 'gpt-5.5' })).toEqual({
      ok: false,
      message: 'Enter your OpenAI API key.',
    });
    expect(loadOwnKey(storage)).toEqual(OWN_KEY);
  });

  it('asks for a key when none is saved', () => {
    expect(changeOwnKeyModel(memoryStorage(), OWN_KEY.choice)).toMatchObject({ ok: false });
  });
});

describe('ownKeyChoice', () => {
  it('gives the provider and model of the saved key, or null', () => {
    const storage = memoryStorage();
    expect(ownKeyChoice(storage)).toBeNull();
    saveOwnKey(storage, OWN_KEY);
    expect(ownKeyChoice(storage)).toEqual(OWN_KEY.choice);
  });
});

describe('forgetOwnKey', () => {
  it('removes the saved key', () => {
    const storage = memoryStorage();
    saveOwnKey(storage, OWN_KEY);
    forgetOwnKey(storage);
    expect(loadOwnKey(storage)).toBeNull();
  });

  it('does not throw when storage is unavailable', () => {
    expect(() => forgetOwnKey(blocked)).not.toThrow();
    expect(() => forgetOwnKey(null)).not.toThrow();
  });
});
