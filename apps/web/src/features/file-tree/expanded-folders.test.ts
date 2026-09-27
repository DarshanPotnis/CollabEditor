import { describe, expect, it } from 'vitest';
import { expandedKey, loadExpanded, saveExpanded } from './expanded-folders.js';

function memory(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
} {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('expanded folders', () => {
  it('round-trips per project', () => {
    const storage = memory();
    saveExpanded(storage, 'p1', new Set(['a', 'b']));
    expect(loadExpanded(storage, 'p1')).toEqual(new Set(['a', 'b']));
    expect(loadExpanded(storage, 'p2')).toEqual(new Set());
  });

  it('ignores stored values that are not JSON or not a list of ids', () => {
    const storage = memory();
    storage.setItem(expandedKey('p'), '{not json');
    expect(loadExpanded(storage, 'p')).toEqual(new Set());
    storage.setItem(expandedKey('p'), JSON.stringify([1, 2]));
    expect(loadExpanded(storage, 'p')).toEqual(new Set());
  });
});
