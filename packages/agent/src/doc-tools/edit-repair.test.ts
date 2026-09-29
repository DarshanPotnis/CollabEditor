import { describe, expect, it } from 'vitest';
import { resolveEdit } from './edit-repair.js';

const FILE = [
  "import { Router } from 'express';",
  '',
  'export const router = Router();',
  '',
  "router.get('/', (req, res) => {",
  '  res.json([]);',
  '});',
  '',
].join('\n');

describe('resolveEdit', () => {
  it('leaves an edit whose text is in the file alone, even one that starts with a space', () => {
    expect(resolveEdit(FILE, '  res.json([]);', '  res.json([1]);')).toEqual({ kind: 'as-sent' });
    expect(resolveEdit('', '', 'new')).toEqual({ kind: 'as-sent' });
  });

  it("takes read_file's whole prefix off every line, padded numbers included", () => {
    const oldText = " 5| router.get('/', (req, res) => {\n 6|   res.json([]);\n 7| });";
    const newText = " 5| router.get('/', (req, res) => {\n 6|   res.json([1]);\n 7| });";
    expect(resolveEdit(FILE, oldText, newText)).toEqual({
      kind: 'repaired',
      repair: 'line-numbers',
      oldText: "router.get('/', (req, res) => {\n  res.json([]);\n});",
      newText: "router.get('/', (req, res) => {\n  res.json([1]);\n});",
    });
  });

  it('takes the prefix off only the new lines that have it', () => {
    const resolved = resolveEdit(
      FILE,
      '6|   res.json([]);\n7| });',
      '6|   res.json([]);\n});\nrouter.post(x);',
    );
    expect(resolved).toMatchObject({
      repair: 'line-numbers',
      newText: '  res.json([]);\n});\nrouter.post(x);',
    });
  });

  it('takes off the space the prefix leaves when only the number and bar were dropped', () => {
    expect(
      resolveEdit(FILE, " router.get('/', (req, res) => {", " router.get('/list', (req, res) => {"),
    ).toEqual({
      kind: 'repaired',
      repair: 'separator-space',
      oldText: "router.get('/', (req, res) => {",
      newText: "router.get('/list', (req, res) => {",
    });
  });

  it('never repairs into a match that is not unique', () => {
    const twice = `${FILE}\n${FILE}`;
    expect(resolveEdit(twice, " router.get('/', (req, res) => {", 'x')).toMatchObject({
      kind: 'no-match',
    });
  });

  it('names line numbers left in some lines', () => {
    expect(resolveEdit(FILE, "5| router.get('/', (req, res) => {\n  res.json([2]);", 'x')).toEqual({
      kind: 'no-match',
      message:
        'The text to replace is not in the file. It contains read_file\'s line numbers ("14| "): copy only the code after them, with its own indentation.',
    });
  });

  it('names lines that match except for their indentation', () => {
    const oldText = "router.get('/', (req, res) => {\n    res.json([]);\n  });";
    expect(resolveEdit(FILE, oldText, 'x')).toEqual({
      kind: 'no-match',
      message:
        "The text to replace is not in the file. Lines 5–7 match it except for indentation: copy each line's leading spaces exactly as the file has them.",
    });
  });

  it('names the first line that differs, as the file has it and as the text has it', () => {
    const oldText = "router.get('/', (req, res) => {\n  res.json({});";
    expect(resolveEdit(FILE, oldText, 'x')).toEqual({
      kind: 'no-match',
      message: [
        'The text to replace is not in the file. Its first line is line 5 of the file, but line 6 differs.',
        'The file has:  "  res.json([]);"',
        'Your text has: "  res.json({});"',
        'Copy the lines exactly as the file has them.',
      ].join('\n'),
    });
  });

  it('finds one dropped word deep in a long block, as in a recorded session', () => {
    // gemini-3.5-flash-lite copied its own 24-line comment back five times, one word short.
    const comments = Array.from({ length: 12 }, (_, index) => `    // thought ${String(index)}`);
    const file = ["usersRouter.get('/', (req, res) => {", ...comments, '});'].join('\n');
    const copied = [
      "usersRouter.get('/', (req, res) => {",
      ...comments.with(6, '    // thought'),
    ].join('\n');
    expect(resolveEdit(file, copied, 'x')).toMatchObject({
      message: expect.stringContaining(
        'but line 8 differs.\nThe file has:  "    // thought 6"\nYour text has: "    // thought"',
      ) as unknown,
    });
  });

  it('shows a long line around where it differs, and says when the file ends first', () => {
    const long = `const x = [${'1, '.repeat(80)}2];`;
    const file = `start();\n${long}`;
    const message = (oldText: string): string => {
      const resolved = resolveEdit(file, oldText, 'x');
      return resolved.kind === 'no-match' ? resolved.message : '';
    };
    const around = message(`start();\n${long.replace('2];', '3];')}`);
    // 60 characters before the difference, where the line itself is 250.
    expect(around).toMatch(/The file has: {2}"…(1, ){20}2\];"\nYour text has: "…(1, ){20}3\];"/);
    expect(message(`start();\n${long}\nmore();`)).toContain(
      'but line 3 differs.\nThe file has:  nothing: it ends at line 2\nYour text has: "more();"',
    );
  });

  it('says so when the first line differs only in its spaces', () => {
    expect(
      resolveEdit(FILE, "router.get('/', (req, res) => { \n  res.json({});", 'x'),
    ).toMatchObject({
      message: expect.stringContaining(
        'Its first line is line 5 of the file, but differs from it in spacing.\nThe file has:  "router.get(\'/\', (req, res) => {"',
      ) as unknown,
    });
  });

  it('otherwise says the file may have changed', () => {
    expect(resolveEdit(FILE, 'nothing like it', 'x')).toEqual({
      kind: 'no-match',
      message: 'The text to replace is not in the file. It may have changed since it was read.',
    });
  });
});
