import { describe, expect, it } from 'vitest';
import type { DeletedItem } from '@collabcode/shared';
import { deletedByLabel, folderLabel, purgeConfirmation, purgeCount } from './deleted-copy.js';

function item(overrides: Partial<DeletedItem>): DeletedItem {
  return {
    id: 'x',
    kind: 'file',
    name: 'utils.js',
    folderPath: null,
    deletedAt: 1,
    deletedBy: 'bob',
    deletedByName: 'Bob',
    containedCount: 0,
    ...overrides,
  };
}

describe('deletedByLabel', () => {
  it('says you, the recorded name, or someone', () => {
    expect(deletedByLabel(item({ deletedBy: 'me' }), 'me')).toBe('you');
    expect(deletedByLabel(item({}), 'me')).toBe('Bob');
    expect(deletedByLabel(item({ deletedBy: null, deletedByName: null }), 'me')).toBe('someone');
  });
});

describe('folderLabel', () => {
  it('names the folder or the project root', () => {
    expect(folderLabel(item({ folderPath: 'src/lib' }))).toBe('src/lib');
    expect(folderLabel(item({}))).toBe('project root');
  });
});

describe('purgeConfirmation', () => {
  it('names a single file and says it cannot be undone for anyone', () => {
    expect(purgeConfirmation([item({})])).toEqual({
      title: 'Delete “utils.js” forever?',
      message:
        "“utils.js” will be permanently deleted. This can't be undone, for anyone in this project.",
    });
  });

  it('counts what is inside a folder', () => {
    expect(
      purgeConfirmation([item({ name: 'routes', kind: 'folder', containedCount: 3 })]).message,
    ).toMatch(/^“routes” and the 3 items inside it will be permanently deleted\./);
  });

  it('counts everything for Empty all', () => {
    const items = [item({ containedCount: 2 }), item({ id: 'y' })];
    expect(purgeCount(items)).toBe(4);
    expect(purgeConfirmation(items)).toEqual({
      title: 'Empty Recently deleted?',
      message:
        "4 files and folders will be permanently deleted. This can't be undone, for anyone in this project.",
    });
  });
});
