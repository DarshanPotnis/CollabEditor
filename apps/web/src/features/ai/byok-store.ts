/**
 * The person's own AI key (docs/PLAN-AI.md §6.1, bring your own key). It is
 * kept in sessionStorage only, so it belongs to one tab and is gone when that
 * tab closes, and this module is the only one that reads or writes it. What
 * comes back from storage is validated on every read, like any other input.
 */
import { aiKeySchema, byokChoiceSchema, type ByokChoice } from '@collabcode/shared';
import { z } from 'zod';

export const OWN_KEY_STORAGE_KEY = 'collabcode.ai-own-key.v1';

export type OwnKey = { choice: ByokChoice; key: string };

export type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type SaveOwnKeyResult = { ok: true; ownKey: OwnKey } | { ok: false; message: string };

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
  return { ok: true, ownKey: parsed.data };
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
