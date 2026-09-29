import { describe, expect, it } from 'vitest';
import { formatBytes, statusTone } from './response-format.js';

describe('statusTone and formatBytes', () => {
  it('classify and describe', () => {
    expect([200, 302, 404, 500, 101].map(statusTone)).toEqual([
      'success',
      'redirect',
      'client-error',
      'server-error',
      'other',
    ]);
    expect([512, 2048, 3 * 1024 * 1024].map(formatBytes)).toEqual(['512 B', '2.0 KB', '3.0 MB']);
  });
});
