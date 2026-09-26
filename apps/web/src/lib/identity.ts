/**
 * Guest identity: a friendly name and a palette color, generated on first
 * visit and kept in localStorage. There are no accounts in these phases.
 *
 * Storage is injected so the logic can be tested without a browser, and every
 * read is validated with the same schema that guards remote awareness states —
 * our own localStorage is untrusted input too, since anyone can edit it.
 */
import {
  awarenessUserSchema,
  createUserId,
  presenceColorFor,
  sanitizeUserName,
  type AwarenessUser,
} from '@collabcode/shared';

export const IDENTITY_STORAGE_KEY = 'collabcode.identity.v1';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const ADJECTIVES = [
  'brisk',
  'calm',
  'clever',
  'curious',
  'eager',
  'gentle',
  'jolly',
  'keen',
  'lucky',
  'merry',
  'nimble',
  'plucky',
  'quiet',
  'swift',
  'witty',
] as const;

const ANIMALS = [
  'otter',
  'heron',
  'lynx',
  'magpie',
  'gecko',
  'badger',
  'puffin',
  'marten',
  'ibex',
  'raven',
  'dormouse',
  'tapir',
  'osprey',
  'wombat',
  'finch',
] as const;

function pick<T>(items: readonly [T, ...T[]], random: () => number): T {
  // Math.random() can in principle return values that round up to length.
  const index = Math.min(items.length - 1, Math.floor(random() * items.length));
  return items[index] ?? items[0];
}

export function randomGuestName(random: () => number = Math.random): string {
  return `${pick(ADJECTIVES, random)} ${pick(ANIMALS, random)}`;
}

export function createGuestIdentity(random: () => number = Math.random): AwarenessUser {
  const id = createUserId();
  return { id, name: randomGuestName(random), color: presenceColorFor(id), kind: 'human' };
}

/** Read the stored identity, replacing anything missing or malformed. */
export function loadIdentity(storage: StorageLike | null): AwarenessUser {
  if (!storage) return createGuestIdentity();

  let raw: string | null;
  try {
    raw = storage.getItem(IDENTITY_STORAGE_KEY);
  } catch {
    return createGuestIdentity();
  }
  if (raw === null) return createGuestIdentity();

  try {
    const parsed = awarenessUserSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : createGuestIdentity();
  } catch {
    return createGuestIdentity();
  }
}

/** Best effort: a browser with storage disabled just gets a new name per visit. */
export function saveIdentity(storage: StorageLike | null, identity: AwarenessUser): void {
  if (!storage) return;
  try {
    storage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private mode or a full quota. Not worth interrupting the user for.
  }
}

/** Rename, keeping the identity usable if the new name is empty or unsafe. */
export function withName(identity: AwarenessUser, name: string): AwarenessUser {
  const sanitized = sanitizeUserName(name);
  return sanitized.length > 0 ? { ...identity, name: sanitized } : identity;
}

/** localStorage, or null where it is unavailable (private mode, blocked). */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
