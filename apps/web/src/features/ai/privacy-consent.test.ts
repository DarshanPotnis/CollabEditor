import { describe, expect, it } from 'vitest';
import { bestEffortStorage } from '../../lib/best-effort-storage.js';
import type { StorageLike } from '../../lib/identity.js';
import {
  PRIVACY_CONSENT_STORAGE_KEY,
  PRIVACY_NOTICE_VERSION,
  hasAcceptedPrivacyNotice,
  recordPrivacyNoticeAccepted,
} from './privacy-consent.js';

function memoryStorage(initial?: string): StorageLike {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(PRIVACY_CONSENT_STORAGE_KEY, initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('privacy notice consent', () => {
  it('is not given until the notice is accepted', () => {
    const storage = memoryStorage();
    expect(hasAcceptedPrivacyNotice(storage)).toBe(false);
    recordPrivacyNoticeAccepted(storage);
    expect(hasAcceptedPrivacyNotice(storage)).toBe(true);
  });

  it('must be given again when the notice changes', () => {
    const earlier = String(PRIVACY_NOTICE_VERSION - 1);
    expect(hasAcceptedPrivacyNotice(memoryStorage(earlier))).toBe(false);
  });

  it('ignores anything else stored under its key', () => {
    expect(hasAcceptedPrivacyNotice(memoryStorage('true'))).toBe(false);
  });

  it('is simply not remembered when storage is blocked', () => {
    const blocked = bestEffortStorage({
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('SecurityError');
      },
    });
    expect(() => recordPrivacyNoticeAccepted(blocked)).not.toThrow();
    expect(hasAcceptedPrivacyNotice(blocked)).toBe(false);
  });
});
