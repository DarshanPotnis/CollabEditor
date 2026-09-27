/**
 * What the AI panel says about a request: what was asked, which key it uses,
 * what an answer cost and what to do after a failure. The failure messages
 * themselves come from the server, written to be shown as they are.
 */
import { AI_PROVIDER_LABELS, lineCount, type ByokChoice } from '@collabcode/shared';
import type { AiFinish, AiStep } from './ai-client.js';
import type { AiFailure } from './ai-request-state.js';

function lineRange(startLine: number, selection: string): string {
  // A selection of whole lines ends with a line break, which starts no new line.
  const lines = lineCount(selection.replace(/\n$/, ''));
  const endLine = startLine + lines - 1;
  return endLine === startLine
    ? `line ${String(startLine)}`
    : `lines ${String(startLine)}–${String(endLine)}`;
}

/** A file and the lines a selection covers, such as "routes/users.js, lines 12–14". */
export function describeSelection(path: string, startLine: number, selection: string): string {
  return `${path}, ${lineRange(startLine, selection)}`;
}

/** One line saying what was asked, shown above the answer. */
export function describeStep(step: AiStep): string {
  switch (step.promptId) {
    case 'explain-selection': {
      const { path, startLine, selection } = step.inputs;
      return `Explain ${describeSelection(path, startLine, selection)}`;
    }
    case 'edit-selection': {
      const { path, startLine, selection, instruction } = step.inputs;
      return `Edit ${describeSelection(path, startLine, selection)}: ${instruction.trim()}`;
    }
    case 'explain-error':
      return 'Explain why the run stopped';
  }
}

/** Which key requests will use. */
export function keyStatus(choice: ByokChoice | null): string {
  return choice === null
    ? 'Shared free tier'
    : `Your ${AI_PROVIDER_LABELS[choice.provider]} key · ${choice.model}`;
}

function freeRequestsLeft(remaining: number): string {
  if (remaining === 0) return 'no free requests left today';
  return remaining === 1
    ? '1 free request left today'
    : `${String(remaining)} free requests left today`;
}

/** The model that answered, and what is left of the day's free requests. */
export function usageLine(finish: AiFinish): string {
  const left =
    finish.remainingToday === null
      ? `your ${AI_PROVIDER_LABELS[finish.model.provider]} key`
      : freeRequestsLeft(finish.remainingToday);
  return `${finish.model.id} · ${left}`;
}

/** Why a finished answer may be incomplete, or null when it is not. */
export function finishNote(finish: AiFinish): string | null {
  switch (finish.finishReason) {
    case 'length':
      return 'The answer reached its length limit and was cut off.';
    case 'content-filter':
      return "The provider's content filter stopped this answer.";
    default:
      return null;
  }
}

/**
 * The label for a button that opens AI settings after this failure, or null
 * when settings cannot help. On the shared tier, running out or a busy or
 * broken shared key is solved by an own key; with an own key, only a refused
 * key is something settings can fix.
 */
export function settingsAction(failure: AiFailure, usingOwnKey: boolean): string | null {
  if (failure.code === 'invalid-key') return 'Check your key';
  if (usingOwnKey) return null;
  const sharedTierProblem =
    failure.code === 'quota-exhausted' ||
    failure.code === 'rate-limited' ||
    failure.code === 'unavailable';
  return sharedTierProblem ? 'Add your own key' : null;
}
