import { describe, expect, it } from 'vitest';
import { PRESENCE_COLORS, MAX_USER_NAME_LENGTH } from '@collabcode/shared';
import {
  IDENTITY_STORAGE_KEY,
  createGuestIdentity,
  loadIdentity,
  randomGuestName,
  saveIdentity,
  withName,
  type StorageLike,
} from './identity.js';

function fakeStorage(initial?: string): StorageLike & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key: string) {
      return key === IDENTITY_STORAGE_KEY ? this.value : null;
    },
    setItem(key: string, value: string) {
      if (key === IDENTITY_STORAGE_KEY) this.value = value;
    },
  };
}

describe('createGuestIdentity', () => {
  it('produces an identity that passes the awareness schema', () => {
    const identity = createGuestIdentity();
    expect(identity.kind).toBe('human');
    expect(PRESENCE_COLORS).toContain(identity.color);
    expect(identity.name.length).toBeGreaterThan(0);
  });

  it('gives different visitors different ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createGuestIdentity().id));
    expect(ids.size).toBe(50);
  });
});

describe('randomGuestName', () => {
  it('is two readable words', () => {
    expect(randomGuestName(() => 0)).toMatch(/^[a-z]+ [a-z]+$/);
  });

  it('stays in range when random returns almost 1', () => {
    expect(randomGuestName(() => 0.999999)).toMatch(/^[a-z]+ [a-z]+$/);
  });
});

describe('loadIdentity', () => {
  it('round-trips a saved identity', () => {
    const storage = fakeStorage();
    const identity = createGuestIdentity();
    saveIdentity(storage, identity);
    expect(loadIdentity(storage)).toEqual(identity);
  });

  it('creates a fresh identity when nothing is stored', () => {
    expect(loadIdentity(fakeStorage()).kind).toBe('human');
  });

  it('creates a fresh identity when there is no storage at all', () => {
    expect(loadIdentity(null).kind).toBe('human');
  });

  it.each([
    ['broken JSON', '{ not json'],
    ['a color outside the palette', '{"id":"a","name":"Ada","color":"#000000","kind":"human"}'],
    [
      'a name that is only control characters',
      '{"id":"a","name":"\\u0000","color":"#2563eb","kind":"human"}',
    ],
    ['a missing field', '{"id":"a","name":"Ada"}'],
    ['an injected kind', '{"id":"a","name":"Ada","color":"#2563eb","kind":"admin"}'],
  ])('replaces a stored identity with %s', (_label, stored) => {
    const identity = loadIdentity(fakeStorage(stored));
    expect(PRESENCE_COLORS).toContain(identity.color);
    expect(identity.kind).toBe('human');
    expect(identity.name).not.toBe('');
  });

  it('survives a storage that throws, as in private mode', () => {
    const hostile: StorageLike = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    expect(() => loadIdentity(hostile)).not.toThrow();
    expect(() => saveIdentity(hostile, createGuestIdentity())).not.toThrow();
  });
});

describe('withName', () => {
  it('sanitizes and caps the new name', () => {
    const identity = createGuestIdentity();
    expect(withName(identity, '  Ada\nLovelace  ').name).toBe('Ada Lovelace');
    expect(withName(identity, 'a'.repeat(100)).name).toHaveLength(MAX_USER_NAME_LENGTH);
  });

  it('keeps the old name when the new one is empty after sanitizing', () => {
    const identity = createGuestIdentity();
    expect(withName(identity, '   ').name).toBe(identity.name);
    expect(withName(identity, '\u0000​').name).toBe(identity.name);
  });

  it('keeps the id and color', () => {
    const identity = createGuestIdentity();
    const renamed = withName(identity, 'Grace');
    expect(renamed).toMatchObject({ id: identity.id, color: identity.color });
  });
});
