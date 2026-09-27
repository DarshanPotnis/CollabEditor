import { describe, expect, it } from 'vitest';
import { OpError } from '../op-error.js';
import { layoutTemplate } from './layout.js';

describe('layoutTemplate', () => {
  it('creates each folder once, before its children', () => {
    const entries = layoutTemplate([
      { path: 'src/a.js', content: 'a' },
      { path: 'src/lib/b.js', content: 'b' },
      { path: 'top.js', content: 't' },
    ]);

    expect(entries.map((entry) => [entry.kind, entry.path, entry.parentPath])).toEqual([
      ['folder', 'src', null],
      ['file', 'src/a.js', 'src'],
      ['folder', 'src/lib', 'src'],
      ['file', 'src/lib/b.js', 'src/lib'],
      ['file', 'top.js', null],
    ]);
    expect(entries[1]).toMatchObject({ name: 'a.js', content: 'a' });
  });

  it.each([
    ['an empty segment', 'src//a.js'],
    ['a leading slash', '/a.js'],
    ['a dot-dot segment', 'src/../a.js'],
  ])('rejects %s', (_label, path) => {
    expect(() => layoutTemplate([{ path, content: '' }])).toThrow(OpError);
  });

  it('rejects paths that clash, including by case or as file and folder', () => {
    expect(() =>
      layoutTemplate([
        { path: 'a.js', content: '' },
        { path: 'A.js', content: '' },
      ]),
    ).toThrow(/clashes/);
    expect(() =>
      layoutTemplate([
        { path: 'lib', content: '' },
        { path: 'lib/a.js', content: '' },
      ]),
    ).toThrow(/clashes/);
  });
});
