/**
 * Turns a run that stopped into a step for the explain-error prompt: how it
 * ended, the end of its output as plain text, and, when the output points at
 * a project file, its code: the lines around the crash when the line number
 * is exact (CommonJS), or the whole file, if it fits, when it is not (ES
 * modules, whose lines WebContainer shifts; see stack-locations.ts).
 */
import { AI_INPUT_LIMITS, PROMPTS, type RunOutcome } from '@collabcode/shared';
import { languageForFileName } from '../../editor/language.js';
import type { RunState } from '../../runtime/run-state.js';
import { crashLocation } from '../stack-locations.js';
import { terminalTail } from '../terminal-text.js';
import type { BuiltStep } from './selection-prompts.js';

/** Lines of code on each side of the crash line, before the character cap applies. */
export const EXCERPT_RADIUS = 15;

export type RunFailure = { outcome: RunOutcome; exitCode?: number; rawOutput: string };

/** The project's files, as far as this prompt needs them. */
export type ProjectFiles = {
  paths: ReadonlySet<string>;
  read: (path: string) => string | null;
};

type Excerpt = { startLine: number; code: string; focusLine?: number };

function crashFailure(
  state: Extract<RunState, { phase: 'crashed' }>,
  rawOutput: string,
): RunFailure {
  switch (state.reason) {
    case 'exited':
      return { outcome: 'exited', exitCode: state.exitCode, rawOutput };
    case 'stopped-listening':
      return { outcome: 'stopped-listening', rawOutput };
    case 'watch-failed':
      // The program exited with an error; its watcher keeps running and does not say the code.
      return { outcome: 'exited', rawOutput };
  }
}

/** How the run stopped, when it stopped on an error; null otherwise. */
export function runFailure(state: RunState, rawOutput: string): RunFailure | null {
  switch (state.phase) {
    case 'crashed':
      return crashFailure(state, rawOutput);
    case 'failed':
      return { outcome: 'failed', rawOutput };
    default:
      return null;
  }
}

/**
 * The lines around `focusLine`, as many as fit the cap, dropping from the
 * side with more lines first. Null when the line is not in the file (the
 * file changed since the crash) or is by itself too long to send.
 */
export function codeExcerpt(text: string, focusLine: number): Excerpt | null {
  const lines = text.split('\n');
  if (focusLine > lines.length) return null;
  let first = Math.max(1, focusLine - EXCERPT_RADIUS);
  let last = Math.min(lines.length, focusLine + EXCERPT_RADIUS);
  const code = (): string => lines.slice(first - 1, last).join('\n');
  while (code().length > AI_INPUT_LIMITS.excerptChars) {
    if (first === focusLine && last === focusLine) return null;
    if (focusLine - first >= last - focusLine) first += 1;
    else last -= 1;
  }
  return { startLine: first, code: code(), focusLine };
}

/** The whole file with no crash line claimed, or null when it is too long to send. */
export function wholeFile(text: string): Excerpt | null {
  return text.length > 0 && text.length <= AI_INPUT_LIMITS.excerptChars
    ? { startLine: 1, code: text }
    : null;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function explainErrorStep(
  projectId: string,
  failure: RunFailure,
  files: ProjectFiles,
): BuiltStep {
  const terminalOutput = terminalTail(failure.rawOutput);
  const location = crashLocation(terminalOutput, files.paths);
  const text = location ? files.read(location.path) : null;
  const excerpt =
    location && text !== null
      ? location.exactLine
        ? codeExcerpt(text, location.line)
        : wholeFile(text)
      : null;

  const inputs = {
    outcome: failure.outcome,
    ...(failure.exitCode === undefined ? {} : { exitCode: failure.exitCode }),
    terminalOutput,
    ...(location && excerpt
      ? {
          excerpt: {
            path: location.path,
            language: languageForFileName(fileName(location.path)),
            startLine: excerpt.startLine,
            code: excerpt.code,
            ...(excerpt.focusLine === undefined ? {} : { focusLine: excerpt.focusLine }),
          },
        }
      : {}),
  };
  const checked = PROMPTS['explain-error'].inputs.safeParse(inputs);
  if (!checked.success) {
    return {
      ok: false,
      message: checked.error.issues[0]?.message ?? 'This run cannot be sent to the AI.',
    };
  }
  return { ok: true, step: { projectId, promptId: 'explain-error', inputs } };
}
