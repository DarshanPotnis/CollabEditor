const NAMES = [
  "CoderFox",
  "DevTiger",
  "ByteWizard",
  "PixelNinja",
  "AlgoKnight",
  "StackHero",
  "CodeWolf",
];

// Peers interpolate this into a stylesheet, so it stays a plain hex color.
const COLORS = ["#22c55e", "#3b82f6", "#a855f7", "#f97316", "#ef4444"];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** A throwaway identity for one editor session. */
export function createIdentity() {
  return {
    username: `${pick(NAMES)}${Math.floor(Math.random() * 100)}`,
    color: pick(COLORS),
  };
}
