import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time.js';

const now = Date.parse('2026-09-26T12:00:00Z');
const ago = (seconds: number): number => now - seconds * 1000;

describe('relativeTime', () => {
  it.each([
    [10, 'just now'],
    [50, '1 minute ago'],
    [5 * 60, '5 minutes ago'],
    [3 * 3600, '3 hours ago'],
    [26 * 3600, 'yesterday'],
    [9 * 24 * 3600, 'last week'],
    [400 * 24 * 3600, 'last year'],
  ])('%i seconds ago reads "%s"', (seconds, expected) => {
    expect(relativeTime(ago(seconds), now)).toBe(expected);
  });

  it('treats a timestamp from a fast clock as just now', () => {
    expect(relativeTime(now + 20_000, now)).toBe('just now');
  });
});
