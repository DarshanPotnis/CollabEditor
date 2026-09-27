import { describe, expect, it } from 'vitest';
import { URI } from 'monaco-editor/base/common/uri';
import { DELETED_SCHEME, deletedFileUri, liveFileUri } from './model-uri.js';

describe('liveFileUri', () => {
  it.each([
    ['index.js', 'file:///index.js'],
    ['src/my file.js', 'file:///src/my%20file.js'],
    ['notes#1.md', 'file:///notes%231.md'],
    ['what?.js', 'file:///what%3F.js'],
    ['100%.txt', 'file:///100%25.txt'],
    ['src/ünï/cødé.js', 'file:///src/%C3%BCn%C3%AF/c%C3%B8d%C3%A9.js'],
    ['utils (2).js', 'file:///utils%20%282%29.js'],
  ])('%s → %s', (path, expected) => {
    expect(liveFileUri(path).toString()).toBe(expected);
  });

  it.each(['a#b?c%d e/ü.js', 'dir/100% done?#yes.md', '日本語/ファイル.ts'])(
    'round-trips %s through its string form without losing or misreading anything',
    (path) => {
      const parsed = URI.parse(liveFileUri(path).toString());
      expect(parsed.scheme).toBe('file');
      expect(parsed.path).toBe(`/${path}`);
      expect(parsed.query).toBe('');
      expect(parsed.fragment).toBe('');
    },
  );

  it('gives different paths different URIs, even when naive concatenation would not', () => {
    expect(liveFileUri('a#b').toString()).not.toBe(liveFileUri('a').toString());
    expect(liveFileUri('a?b').toString()).not.toBe(liveFileUri('a').toString());
  });
});

describe('deletedFileUri', () => {
  it('uses its own scheme and the id, so it never collides with a live path', () => {
    const uri = deletedFileUri('abc123', 'index.js');
    expect(uri.scheme).toBe(DELETED_SCHEME);
    expect(uri.toString()).not.toBe(liveFileUri('index.js').toString());
    expect(deletedFileUri('other', 'index.js').toString()).not.toBe(uri.toString());
  });
});
