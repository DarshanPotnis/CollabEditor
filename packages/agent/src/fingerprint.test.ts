import { describe, expect, it } from 'vitest';
import { projectFingerprint } from './fingerprint.js';

const files = [
  { path: 'index.js', content: 'app.listen(3000);\n' },
  { path: 'routes/users.js', content: 'export const users = [];\n' },
];

describe('projectFingerprint', () => {
  it('is the same for the same files in any order', () => {
    expect(projectFingerprint(files)).toBe(projectFingerprint(files.toReversed()));
    expect(projectFingerprint(files)).toMatch(/^[0-9a-f]{28}$/);
  });

  it('changes with a file’s content or name', () => {
    const base = projectFingerprint(files);
    expect(projectFingerprint([files[0]!, { ...files[1]!, content: 'x' }])).not.toBe(base);
    expect(projectFingerprint([files[0]!, { ...files[1]!, path: 'routes/user.js' }])).not.toBe(
      base,
    );
  });

  it('cannot be fooled by moving text between a name and its content', () => {
    expect(projectFingerprint([{ path: 'ab', content: 'c' }])).not.toBe(
      projectFingerprint([{ path: 'a', content: 'bc' }]),
    );
  });
});
