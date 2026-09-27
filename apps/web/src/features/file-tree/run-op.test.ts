import { describe, expect, it } from 'vitest';
import { OpError } from '@collabcode/shared';
import { runOp } from './run-op.js';

describe('runOp', () => {
  it('returns the value', () => {
    expect(runOp(() => 42)).toEqual({ ok: true, value: 42 });
  });

  it('turns an OpError into a result', () => {
    const result = runOp(() => {
      throw new OpError('duplicate-name', 'taken');
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('taken');
  });

  it('lets any other error through', () => {
    expect(() =>
      runOp(() => {
        throw new TypeError('bug');
      }),
    ).toThrow(TypeError);
  });
});
