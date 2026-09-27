/**
 * Turns an editor selection into a step for the selection prompts. The lines
 * around the selection go along as context: whole lines, nearest first, as
 * many as fit the shared caps, so a request is only refused when the part the
 * person chose (the selection, the instruction) is itself too long.
 *
 * Context lines match how the prompt numbers them: `before` ends on the line
 * above the selection's first line and `after` starts on the line below its
 * last, so a partial first or last line is not repeated.
 */
import { AI_INPUT_LIMITS, PROMPTS } from '@collabcode/shared';
import type { AiStep } from '../ai-client.js';

/** Most lines of context on each side, before the character cap applies. */
export const CONTEXT_LINES = 30;

export type SelectionSource = {
  path: string;
  language: string;
  /** The whole file. */
  text: string;
  /** Offsets of the selection in `text`. */
  start: number;
  end: number;
};

export type BuiltStep = { ok: true; step: AiStep } | { ok: false; message: string };

/** The 1-based line an offset falls on. */
export function lineOfOffset(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

function fitLines(lines: string[], maxChars: number, dropFrom: 'start' | 'end'): string {
  const kept = [...lines];
  while (kept.length > 0 && kept.join('\n').length > maxChars) {
    if (dropFrom === 'start') kept.shift();
    else kept.pop();
  }
  return kept.join('\n');
}

/** Whole lines above the selection's first line, keeping the nearest. */
export function contextBefore(text: string, start: number): string {
  const firstLineStart = text.lastIndexOf('\n', start - 1) + 1;
  if (firstLineStart === 0) return '';
  const lines = text
    .slice(0, firstLineStart - 1)
    .split('\n')
    .slice(-CONTEXT_LINES);
  return fitLines(lines, AI_INPUT_LIMITS.contextChars, 'start');
}

/** Whole lines below the selection's last line, keeping the nearest. */
export function contextAfter(text: string, end: number): string {
  const lastLineEnd = text.indexOf('\n', end);
  if (lastLineEnd === -1) return '';
  const lines = text.slice(lastLineEnd + 1).split('\n');
  // The file's final line break starts no line of its own.
  if (lines.at(-1) === '') lines.pop();
  return fitLines(lines.slice(0, CONTEXT_LINES), AI_INPUT_LIMITS.contextChars, 'end');
}

function selectionFields(source: SelectionSource): {
  path: string;
  language: string;
  startLine: number;
  selection: string;
  before: string;
  after: string;
} {
  const { text, start, end } = source;
  return {
    path: source.path,
    language: source.language,
    startLine: lineOfOffset(text, start),
    selection: text.slice(start, end),
    before: contextBefore(text, start),
    after: contextAfter(text, end),
  };
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'This selection cannot be sent to the AI.';
}

export function explainSelectionStep(projectId: string, source: SelectionSource): BuiltStep {
  const inputs = selectionFields(source);
  const checked = PROMPTS['explain-selection'].inputs.safeParse(inputs);
  if (!checked.success) return { ok: false, message: firstIssue(checked.error) };
  return { ok: true, step: { projectId, promptId: 'explain-selection', inputs } };
}

export function editSelectionStep(
  projectId: string,
  source: SelectionSource,
  instruction: string,
): BuiltStep {
  const inputs = { ...selectionFields(source), instruction };
  const checked = PROMPTS['edit-selection'].inputs.safeParse(inputs);
  if (!checked.success) return { ok: false, message: firstIssue(checked.error) };
  return { ok: true, step: { projectId, promptId: 'edit-selection', inputs } };
}
