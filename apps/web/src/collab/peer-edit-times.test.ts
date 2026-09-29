import { describe, expect, it } from 'vitest';
import { createPeerEditTimes } from './peer-edit-times.js';

const RECENT = 30_000;

describe('createPeerEditTimes', () => {
  it('times a change by when it was seen, whatever the peer’s clock says', () => {
    const times = createPeerEditTimes(RECENT);
    times.note(1, 5, 100_000);
    times.note(1, 6, 250_000);
    expect(times.lastEditAt(1)).toBe(250_000);
  });

  it('keeps the time of the change while the value stays the same', () => {
    const times = createPeerEditTimes(RECENT);
    times.note(1, 5, 100_000);
    times.note(1, 6, 110_000);
    times.note(1, 6, 190_000);
    expect(times.lastEditAt(1)).toBe(110_000);
  });

  it('trusts a first sighting only when it looks recent by this clock', () => {
    const times = createPeerEditTimes(RECENT);
    times.note(1, 95_000, 100_000);
    times.note(2, 104_000, 100_000);
    times.note(3, 10_000, 100_000);
    times.note(4, 900_000, 100_000);
    expect(times.lastEditAt(1)).toBe(95_000);
    expect(times.lastEditAt(2)).toBe(100_000);
    expect(times.lastEditAt(3)).toBeNull();
    expect(times.lastEditAt(4)).toBeNull();
  });

  it('forgets a peer who never edited or has left', () => {
    const times = createPeerEditTimes(RECENT);
    times.note(1, 95_000, 100_000);
    times.note(1, undefined, 101_000);
    expect(times.lastEditAt(1)).toBeNull();
    times.note(2, 95_000, 100_000);
    times.forget(2);
    expect(times.lastEditAt(2)).toBeNull();
  });
});
