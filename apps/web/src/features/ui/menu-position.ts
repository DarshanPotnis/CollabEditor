/**
 * Where to put a context menu so it stays on screen: at the pointer, flipped
 * left or up when it would overflow, and never closer than a margin to the
 * viewport edge.
 */
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

const MARGIN = 8;

export function menuPosition(anchor: Point, menu: Size, viewport: Size): Point {
  const fitsRight = anchor.x + menu.width + MARGIN <= viewport.width;
  const fitsBelow = anchor.y + menu.height + MARGIN <= viewport.height;
  const x = fitsRight ? anchor.x : anchor.x - menu.width;
  const y = fitsBelow ? anchor.y : anchor.y - menu.height;
  return {
    x: Math.max(MARGIN, Math.min(x, viewport.width - menu.width - MARGIN)),
    y: Math.max(MARGIN, Math.min(y, viewport.height - menu.height - MARGIN)),
  };
}
