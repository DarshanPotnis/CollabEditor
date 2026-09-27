/**
 * Suffixed names for siblings that share a name, which only happens when two
 * clients create the same name concurrently (see resolve-tree.ts).
 *
 * The suffix goes before the extension so the file keeps its language:
 * `utils.js` becomes `utils (2).js`, not `utils.js (2)`. A leading dot is part
 * of the name, not an extension, so `.env` becomes `.env (2)`.
 */

/** Split a name into the part before its extension and the extension itself. */
export function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: '' };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

/** `utils.js`, 2 → `utils (2).js`. */
export function withCopySuffix(name: string, copy: number): string {
  const { stem, extension } = splitExtension(name);
  return `${stem} (${String(copy)})${extension}`;
}
