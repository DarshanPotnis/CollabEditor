import { describe, expect, it } from 'vitest';
import { splitExtension, withCopySuffix } from './display-name.js';

describe('withCopySuffix', () => {
  it.each([
    ['utils.js', 2, 'utils (2).js'],
    ['archive.tar.gz', 3, 'archive.tar (3).gz'],
    ['Makefile', 2, 'Makefile (2)'],
    ['.env', 2, '.env (2)'],
    ['.eslintrc.json', 2, '.eslintrc (2).json'],
    ['trailing.', 2, 'trailing. (2)'],
    ['src', 4, 'src (4)'],
  ])('%s, copy %i → %s', (name, copy, expected) => {
    expect(withCopySuffix(name, copy)).toBe(expected);
  });
});

describe('splitExtension', () => {
  it('treats a leading dot as part of the name', () => {
    expect(splitExtension('.gitignore')).toEqual({ stem: '.gitignore', extension: '' });
  });
});
