/**
 * Identifier generation. Project IDs appear in URLs people paste to each
 * other, so the alphabet leaves out characters that are easy to misread.
 */
import { customAlphabet } from 'nanoid';

const URL_SAFE_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

const generate = customAlphabet(URL_SAFE_ALPHABET, 12);

export function createProjectId(): string {
  return generate();
}

export function createNodeId(): string {
  return generate();
}
