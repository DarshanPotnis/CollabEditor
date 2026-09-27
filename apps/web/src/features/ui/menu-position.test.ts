import { describe, expect, it } from 'vitest';
import { menuPosition } from './menu-position.js';

const viewport = { width: 1000, height: 800 };
const menu = { width: 200, height: 150 };

describe('menuPosition', () => {
  it('opens at the pointer when it fits', () => {
    expect(menuPosition({ x: 100, y: 100 }, menu, viewport)).toEqual({ x: 100, y: 100 });
  });

  it('flips left and up near the right and bottom edges', () => {
    expect(menuPosition({ x: 950, y: 780 }, menu, viewport)).toEqual({ x: 750, y: 630 });
  });

  it('never leaves the viewport, even for a menu taller than the space', () => {
    expect(menuPosition({ x: 2, y: 2 }, { width: 200, height: 900 }, viewport)).toEqual({
      x: 8,
      y: 8,
    });
  });
});
