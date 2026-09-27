/**
 * Whether the AI answer on screen is an edit ready to review, for the
 * selection it was asked about.
 *
 * An edit's target (the file and the anchored selection) stays in the
 * browser; only the step goes to the server. The answer belongs to the target
 * when the request state holds that very step object, which is also true after
 * Try again, since that resends the same step.
 */
import { extractReplacement, matchTrailingNewline } from '@collabcode/shared';
import type { SelectionAnchor } from '../editor/selection-anchor.js';
import type { AiStep } from './ai-client.js';
import type { AiRequestState } from './ai-request-state.js';

export type EditTarget = {
  step: AiStep;
  fileId: string;
  path: string;
  language: string;
  /** The selection's first line, for line numbers in the diff. */
  startLine: number;
  anchor: SelectionAnchor;
};

export type EditProposal =
  /** No edit is waiting, or its answer is not complete yet. */
  | { kind: 'none' }
  | { kind: 'ready'; target: EditTarget; replacement: string }
  | { kind: 'unusable'; target: EditTarget; message: string };

export function editProposal(state: AiRequestState, target: EditTarget | null): EditProposal {
  if (!target || state.phase !== 'done' || state.step !== target.step) return { kind: 'none' };
  if (state.finish.finishReason === 'length') {
    return {
      kind: 'unusable',
      target,
      message: 'The edit was cut off before it was finished. Try a smaller selection.',
    };
  }
  const extracted = extractReplacement(state.text);
  if (!extracted.ok) return { kind: 'unusable', target, message: extracted.message };

  const replacement = matchTrailingNewline(target.anchor.original, extracted.code);
  if (replacement === target.anchor.original) {
    return {
      kind: 'unusable',
      target,
      message:
        'The AI left the code unchanged. It may not be able to do this safely; try rephrasing the instruction.',
    };
  }
  return { kind: 'ready', target, replacement };
}
