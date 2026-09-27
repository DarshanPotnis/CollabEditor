/**
 * A storage wrapper for preferences that are nice to keep but never worth an
 * error: pane sizes, expanded folders. Reads that fail act like an empty
 * store and writes that fail are dropped, so private mode, a blocked site or a
 * full quota just means the preference does not stick.
 */
import type { StorageLike } from './identity.js';

export function bestEffortStorage(storage: StorageLike | null): StorageLike {
  return {
    getItem(key) {
      if (!storage) return null;
      try {
        return storage.getItem(key);
      } catch {
        // Unreadable storage is the same as nothing saved yet.
        return null;
      }
    },
    setItem(key, value) {
      if (!storage) return;
      try {
        storage.setItem(key, value);
      } catch {
        // A preference that does not persist is not worth interrupting anyone.
      }
    },
  };
}
