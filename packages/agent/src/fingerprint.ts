/**
 * A short fingerprint of a project's files, recorded in a trace so a replay can
 * tell whether it starts from the same project the session did. Not a security
 * hash: two different projects sharing one is harmless and very unlikely. It is
 * pure arithmetic so the browser and Node compute the same value.
 */

export type FileContent = { path: string; content: string };

/** 53 bits of a string's hash (cyrb53), mixed with a seed. */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The same files give the same fingerprint, in any order. */
export function projectFingerprint(files: readonly FileContent[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const text = sorted.map((file) => `${file.path}\u0000${file.content}\u0000`).join('');
  return `${cyrb53(text, 1).toString(16).padStart(14, '0')}${cyrb53(text, 2).toString(16).padStart(14, '0')}`;
}
