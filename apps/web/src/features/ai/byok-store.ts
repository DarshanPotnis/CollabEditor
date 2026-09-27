/**
 * The person's own AI key (docs/PLAN-AI.md §6.1, bring your own key). It is
 * kept in sessionStorage only, so it belongs to one tab and is gone when that
 * tab closes, and this module is the only one that reads or writes it. What
 * comes back from storage is validated on every read, like any other input.
 */
import {
  AI_PROVIDER_LABELS,
  aiKeySchema,
  byokChoiceSchema,
  type ByokChoice,
} from '@collabcode/shared';
import { z } from 'zod';

export const OWN_KEY_STORAGE_KEY = 'collabcode.ai-own-key.v1';

export type OwnKey = { choice: ByokChoice; key: string };

export type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** What a save reports back: the provider and model, never the key. */
export type SaveOwnKeyResult = { ok: true; choice: ByokChoice } | { ok: false; message: string };

const ownKeySchema = z.object({ choice: byokChoiceSchema, key: aiKeySchema });

const STORAGE_BLOCKED =
  'Your browser is blocking storage for this site, so your key cannot be kept. Allow site data and try again.';

/** The saved key, or null when there is none or what is stored is not valid. */
export function loadOwnKey(storage: KeyStorage | null): OwnKey | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(OWN_KEY_STORAGE_KEY);
  } catch {
    // Unreadable storage holds no key we could use.
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = ownKeySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Not JSON: something other than this module wrote it.
    return null;
  }
}

/** Validates the key and keeps it for this tab, or says why it could not. */
export function saveOwnKey(storage: KeyStorage | null, input: OwnKey): SaveOwnKeyResult {
  const parsed = ownKeySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'That key is not valid.' };
  }
  if (!storage) return { ok: false, message: STORAGE_BLOCKED };
  try {
    storage.setItem(OWN_KEY_STORAGE_KEY, JSON.stringify(parsed.data));
  } catch {
    return { ok: false, message: STORAGE_BLOCKED };
  }
  return { ok: true, choice: parsed.data.choice };
}

/**
 * Moves the saved key to another model of the same provider. A different
 * provider needs its own key, so that is refused with a message saying so.
 */
export function changeOwnKeyModel(
  storage: KeyStorage | null,
  choice: ByokChoice,
): SaveOwnKeyResult {
  const saved = loadOwnKey(storage);
  if (saved?.choice.provider !== choice.provider) {
    return { ok: false, message: `Enter your ${AI_PROVIDER_LABELS[choice.provider]} API key.` };
  }
  return saveOwnKey(storage, { choice, key: saved.key });
}

/** The provider and model of the saved key, for showing which is in use. */
export function ownKeyChoice(storage: KeyStorage | null): ByokChoice | null {
  return loadOwnKey(storage)?.choice ?? null;
}

export function forgetOwnKey(storage: KeyStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(OWN_KEY_STORAGE_KEY);
  } catch {
    // Storage that refuses access could not have kept a key either.
  }
}

/** sessionStorage, or null where it is unavailable (blocked site data). */
export function browserSessionStorage(): KeyStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
