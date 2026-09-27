import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, languageForFileName } from './language.js';

describe('languageForFileName', () => {
  it.each([
    ['index.js', 'javascript'],
    ['server.mjs', 'javascript'],
    ['App.tsx', 'typescript'],
    ['package.json', 'json'],
    ['README.md', 'markdown'],
    ['styles.CSS', 'css'],
    ['Dockerfile', 'dockerfile'],
    ['docker-compose.yml', 'yaml'],
  ])('maps %s to %s', (fileName, expected) => {
    expect(languageForFileName(fileName)).toBe(expected);
  });

  it.each([
    ['an unknown extension', 'notes.xyz'],
    ['no extension', 'LICENSE'],
    ['a dotfile', '.env'],
    ['an empty name', ''],
    ['whitespace', '   '],
    ['a trailing dot', 'weird.'],
  ])('falls back to plaintext for %s', (_label, fileName) => {
    expect(languageForFileName(fileName)).toBe(DEFAULT_LANGUAGE);
  });

  it('uses the last extension of a multi-part name', () => {
    expect(languageForFileName('archive.tar.md')).toBe('markdown');
  });
});
