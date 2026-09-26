import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_SIZE,
  MAX_TRANSPORT_PAYLOAD,
  fileSizeLimitMessage,
  isWithinFileSizeLimit,
} from './limits.js';

describe('file size limit', () => {
  it('allows content up to and including the limit', () => {
    expect(isWithinFileSizeLimit(0)).toBe(true);
    expect(isWithinFileSizeLimit(MAX_FILE_SIZE)).toBe(true);
  });

  it('rejects content past the limit', () => {
    expect(isWithinFileSizeLimit(MAX_FILE_SIZE + 1)).toBe(false);
  });

  it('has a message that names the limit', () => {
    expect(fileSizeLimitMessage()).toContain('512 KB');
  });
});

describe('transport payload limit', () => {
  it('leaves generous headroom over a single file, because one frame can carry a whole document', () => {
    expect(MAX_TRANSPORT_PAYLOAD).toBeGreaterThan(MAX_FILE_SIZE * 4);
  });
});
