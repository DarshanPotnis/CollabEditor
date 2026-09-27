/**
 * Every prompt the server will build. A request naming anything else is
 * refused, which is what keeps a client from sending its own system prompt.
 */
import type { PromptInputs } from '../prompt.js';
import { editSelectionPrompt } from './edit-selection.js';
import { explainErrorPrompt } from './explain-error.js';
import { explainSelectionPrompt } from './explain-selection.js';

export { extractReplacement, matchTrailingNewline, type Replacement } from './edit-selection.js';
export { RUN_OUTCOMES, type RunOutcome } from './explain-error.js';

export const PROMPT_IDS = ['explain-selection', 'edit-selection', 'explain-error'] as const;
export type PromptId = (typeof PROMPT_IDS)[number];

export const PROMPTS = {
  'explain-selection': explainSelectionPrompt,
  'edit-selection': editSelectionPrompt,
  'explain-error': explainErrorPrompt,
} as const satisfies { [Id in PromptId]: { id: Id } };

/** The `inputs` a client sends for a given prompt. */
export type PromptInputsFor<Id extends PromptId> = PromptInputs<(typeof PROMPTS)[Id]>;
