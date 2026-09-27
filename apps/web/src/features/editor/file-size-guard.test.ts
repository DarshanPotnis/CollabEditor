import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE } from '@collabcode/shared';
import {
  fileSizeLimitMessage,
  isAtFileSizeLimit,
  isTextInsertingKey,
  pasteWouldExceedLimit,
  remainingCharacters,
  type KeyLike,
} from './file-size-guard.js';

function key(overrides: Partial<KeyLike>): KeyLike {
  return { key: 'a', ctrlKey: false, metaKey: false, altKey: false, ...overrides };
}

describe('isAtFileSizeLimit', () => {
  it('allows a file right up to the limit', () => {
    expect(isAtFileSizeLimit(MAX_FILE_SIZE - 1)).toBe(false);
    expect(isAtFileSizeLimit(MAX_FILE_SIZE)).toBe(false);
  });

  it('stops one character past it', () => {
    expect(isAtFileSizeLimit(MAX_FILE_SIZE + 1)).toBe(true);
  });
});

describe('isTextInsertingKey', () => {
  it.each(['a', 'Z', '1', ' ', '{', 'é', 'Enter', 'Tab'])('treats %j as text', (k) => {
    expect(isTextInsertingKey(key({ key: k }))).toBe(true);
  });

  it.each(['Backspace', 'Delete', 'ArrowLeft', 'Escape', 'F5', 'Home', 'Shift'])(
    'treats %j as navigation, so deleting still works at the limit',
    (k) => {
      expect(isTextInsertingKey(key({ key: k }))).toBe(false);
    },
  );

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['cmd', { metaKey: true }],
    ['alt', { altKey: true }],
  ])('treats a %s shortcut as a command, not text', (_label, modifiers) => {
    expect(isTextInsertingKey(key({ key: 'z', ...modifiers }))).toBe(false);
    expect(isTextInsertingKey(key({ key: 's', ...modifiers }))).toBe(false);
  });

  it('does not mistake an emoji for a named key', () => {
    expect(isTextInsertingKey(key({ key: '🙂' }))).toBe(true);
  });
});

describe('pasteWouldExceedLimit', () => {
  it('allows a paste that exactly fills the file', () => {
    expect(pasteWouldExceedLimit(MAX_FILE_SIZE - 10, 'x'.repeat(10))).toBe(false);
  });

  it('blocks a paste that overflows by one character', () => {
    expect(pasteWouldExceedLimit(MAX_FILE_SIZE - 10, 'x'.repeat(11))).toBe(true);
  });

  it('blocks a huge paste into an empty file', () => {
    expect(pasteWouldExceedLimit(0, 'x'.repeat(MAX_FILE_SIZE * 2))).toBe(true);
  });
});

describe('remainingCharacters', () => {
  it('counts down to zero and never goes negative', () => {
    expect(remainingCharacters(0)).toBe(MAX_FILE_SIZE);
    expect(remainingCharacters(MAX_FILE_SIZE)).toBe(0);
    expect(remainingCharacters(MAX_FILE_SIZE + 5_000)).toBe(0);
  });
});

describe('fileSizeLimitMessage', () => {
  it('tells the user what to do, not just what went wrong', () => {
    expect(fileSizeLimitMessage()).toMatch(/delete some content/i);
  });
});
