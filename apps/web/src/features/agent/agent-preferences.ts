/**
 * The person's AI teammate preferences, kept per browser. Live typing lets
 * collaborators watch edits being written; off, edits land at once.
 */
import { bestEffortStorage } from '../../lib/best-effort-storage.js';
import { browserStorage } from '../../lib/identity.js';

const LIVE_TYPING_KEY = 'collabcode.agent-live-typing.v1';

export function loadLiveTyping(): boolean {
  return bestEffortStorage(browserStorage()).getItem(LIVE_TYPING_KEY) !== 'off';
}

export function saveLiveTyping(live: boolean): void {
  bestEffortStorage(browserStorage()).setItem(LIVE_TYPING_KEY, live ? 'on' : 'off');
}
