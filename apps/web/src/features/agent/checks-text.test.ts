import { describe, expect, it } from 'vitest';
import { checksLines } from './checks-text.js';

describe('checksLines', () => {
  it('lists the checks it made, and those it listed without making with why', () => {
    expect(
      checksLines({
        made: [
          { kind: 'request', method: 'DELETE', path: '/users/1', status: 204 },
          { kind: 'command', command: 'npm test', exitCode: 0 },
        ],
        notMade: [
          {
            check: { kind: 'request', method: 'DELETE', path: '/users/abc', status: 400 },
            reason: 'not sent',
          },
        ],
      }),
    ).toEqual({
      made: ['DELETE /users/1 → 204', 'npm test → exit code 0'],
      notMade: ['DELETE /users/abc → 400 (not sent)'],
    });
  });
});
