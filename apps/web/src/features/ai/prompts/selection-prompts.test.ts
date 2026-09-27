import { AI_INPUT_LIMITS } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_LINES,
  contextAfter,
  contextBefore,
  editSelectionStep,
  explainSelectionStep,
  type SelectionSource,
} from './selection-prompts.js';

const FILE = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', ''].join('\n');

function select(text: string, from: string, to: string): SelectionSource {
  const start = text.indexOf(from);
  const end = text.indexOf(to) + to.length;
  return { path: 'src/app.js', language: 'javascript', text, start, end };
}

function numbered(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${String(index + 1)}`).join('\n');
}

describe('explainSelectionStep', () => {
  it('sends the selection, its first line and the whole lines around it', () => {
    const built = explainSelectionStep('p1', select(FILE, 'line 3', 'line 3'));
    expect(built).toEqual({
      ok: true,
      step: {
        projectId: 'p1',
        promptId: 'explain-selection',
        inputs: {
          path: 'src/app.js',
          language: 'javascript',
          startLine: 3,
          selection: 'line 3',
          before: 'line 1\nline 2',
          after: 'line 4\nline 5',
        },
      },
    });
  });

  it('leaves out the rest of a partly selected first and last line', () => {
    const start = FILE.indexOf('ne 2');
    const end = FILE.indexOf('line 4') + 'line'.length;
    const built = explainSelectionStep('p1', { ...select(FILE, 'line 2', 'line 2'), start, end });
    expect(built).toMatchObject({
      ok: true,
      step: {
        inputs: {
          startLine: 2,
          selection: 'ne 2\nline 3\nline',
          before: 'line 1',
          after: 'line 5',
        },
      },
    });
  });

  it('numbers a selection of whole lines from its first line', () => {
    const start = FILE.indexOf('line 2');
    const end = FILE.indexOf('line 4');
    const built = explainSelectionStep('p1', { ...select(FILE, 'line 2', 'line 3'), start, end });
    // Ending at the start of line 4 makes line 4 the (empty) last selected line.
    expect(built).toMatchObject({
      ok: true,
      step: { inputs: { startLine: 2, selection: 'line 2\nline 3\n', after: 'line 5' } },
    });
  });

  it('refuses a selection over the cap with the same message as the server', () => {
    const text = 'x'.repeat(AI_INPUT_LIMITS.selectionChars + 1);
    const built = explainSelectionStep('p1', {
      path: 'a.js',
      language: 'javascript',
      text,
      start: 0,
      end: text.length,
    });
    expect(built).toEqual({
      ok: false,
      message: 'The selection is too long for the AI helper (at most 12,000 characters).',
    });
  });
});

describe('editSelectionStep', () => {
  it('adds the instruction', () => {
    const built = editSelectionStep('p1', select(FILE, 'line 3', 'line 3'), 'Uppercase it.');
    expect(built).toMatchObject({
      ok: true,
      step: { promptId: 'edit-selection', inputs: { instruction: 'Uppercase it.' } },
    });
  });

  it('asks for an instruction when there is none', () => {
    expect(editSelectionStep('p1', select(FILE, 'line 3', 'line 3'), '   ')).toEqual({
      ok: false,
      message: 'Say what to change.',
    });
  });
});

describe('context lines', () => {
  it('keeps at most CONTEXT_LINES on each side, the nearest ones', () => {
    const lines = CONTEXT_LINES * 2 + 1;
    const text = numbered(lines * 2);
    const middle = text.indexOf(`line ${String(lines)}\n`);
    const before = contextBefore(text, middle).split('\n');
    const after = contextAfter(text, middle).split('\n');
    expect(before).toHaveLength(CONTEXT_LINES);
    expect(before.at(-1)).toBe(`line ${String(lines - 1)}`);
    expect(after).toHaveLength(CONTEXT_LINES);
    expect(after[0]).toBe(`line ${String(lines + 1)}`);
  });

  it('drops the farthest lines to fit the character cap', () => {
    const long = 'y'.repeat(1_500);
    const text = [long, long, long, 'near', 'SELECTED', 'near', long, long, long].join('\n');
    const start = text.indexOf('SELECTED');
    const before = contextBefore(text, start);
    const after = contextAfter(text, start + 'SELECTED'.length);
    expect(before.length).toBeLessThanOrEqual(AI_INPUT_LIMITS.contextChars);
    expect(before.endsWith('near')).toBe(true);
    expect(before.split('\n')).toHaveLength(3);
    expect(after.startsWith('near')).toBe(true);
    expect(after.length).toBeLessThanOrEqual(AI_INPUT_LIMITS.contextChars);
  });

  it('has nothing to add at the edges of the file', () => {
    expect(contextBefore(FILE, 0)).toBe('');
    expect(contextAfter('only line', 4)).toBe('');
  });
});
