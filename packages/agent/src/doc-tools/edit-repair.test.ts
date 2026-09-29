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

  it('names where the first line is when the rest differs', () => {
    const oldText = "router.get('/', (req, res) => {\n  res.json({});";
    expect(resolveEdit(FILE, oldText, 'x')).toMatchObject({
      message: expect.stringContaining(
        'Its first line is line 5 of the file, but the lines after it differ',
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
