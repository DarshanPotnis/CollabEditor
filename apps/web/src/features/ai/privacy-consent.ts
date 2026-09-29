/**
 * Whether this browser has accepted the AI privacy notice (docs/PLAN-AI.md
 * §6.2), which comes before the first AI request. It is remembered in
 * localStorage so the notice appears once, not on every visit. Changing what
 * the notice says means bumping PRIVACY_NOTICE_VERSION, so everyone reads the
 * new wording before their next request.
 */
import type { StorageLike } from '../../lib/identity.js';

export const PRIVACY_CONSENT_STORAGE_KEY = 'collabcode.ai-privacy-notice';
export const PRIVACY_NOTICE_VERSION = 1;

export function hasAcceptedPrivacyNotice(storage: StorageLike): boolean {
  return storage.getItem(PRIVACY_CONSENT_STORAGE_KEY) === String(PRIVACY_NOTICE_VERSION);
}

export function recordPrivacyNoticeAccepted(storage: StorageLike): void {
  storage.setItem(PRIVACY_CONSENT_STORAGE_KEY, String(PRIVACY_NOTICE_VERSION));
}
