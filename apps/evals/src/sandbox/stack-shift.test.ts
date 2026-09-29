import { describe, expect, it } from 'vitest';
import { shiftStackLines } from './stack-shift.js';

const TRACE = [
  'TypeError: byName is not a function',
  '    at file:///work/project/routes/users.js:12:9',
  '    at ModuleJob.run (node:internal/modules/esm/module_job:271:25)',
  '    at file:///work/project/lib/old.cjs:4:1',
  '    at file:///work/project/index.mjs:3:5',
].join('\n');

describe('shiftStackLines', () => {
  it("shifts the project's ES-module frames the way WebContainer does, and nothing else", () => {
    expect(shiftStackLines(TRACE, 11)).toBe(
      [
        'TypeError: byName is not a function',
        '    at file:///work/project/routes/users.js:23:9',
        '    at ModuleJob.run (node:internal/modules/esm/module_job:271:25)',
        '    at file:///work/project/lib/old.cjs:4:1',
        '    at file:///work/project/index.mjs:14:5',
      ].join('\n'),
    );
  });

  it('leaves the text alone when no shift is asked for', () => {
    expect(shiftStackLines(TRACE, 0)).toBe(TRACE);
  });
});
