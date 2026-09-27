import { describe, expect, it } from 'vitest';
import { bestEffortStorage } from './best-effort-storage.js';

const throwing = {
  getItem(): string | null {
    throw new Error('SecurityError');
  },
  setItem(): void {
    throw new Error('QuotaExceededError');
  },
};

describe('bestEffortStorage', () => {
  it('passes reads and writes through', () => {
    const values = new Map<string, string>();
    const storage = bestEffortStorage({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    });
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
  });

  it('treats a throwing store as empty and drops writes', () => {
    const storage = bestEffortStorage(throwing);
    expect(storage.getItem('k')).toBeNull();
    expect(() => storage.setItem('k', 'v')).not.toThrow();
  });

  it('works with no store at all', () => {
    const storage = bestEffortStorage(null);
    expect(storage.getItem('k')).toBeNull();
    expect(() => storage.setItem('k', 'v')).not.toThrow();
  });
});
