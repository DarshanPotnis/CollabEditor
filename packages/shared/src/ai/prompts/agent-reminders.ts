/**
 * What the server tells the AI agent after the conversation, on a step where
 * there is something it must hear (docs/PLAN-AI.md §5):
 *
 * - that its steps are running out, on each of the last few, so it calls
 *   finish while it still can: a session that runs out ends with no summary;
 * - that a tool call has just failed exactly as an earlier one did, so it stops
 *   repeating it (a recorded session made the same refused call six times).
 *
 * The words are fixed, like the nudge's, and nothing from the conversation is
 * quoted: tool results are text anyone in the project may have written. It is
 * pure, so the agent core can record in its trace what the model was told.
 */
import type { ConversationEntry } from '../conversation.js';
import type { ReminderContext } from '../prompt.js';

/** The steps reminder starts when this many are left, the one being asked for included. */
export const REMIND_STEPS_LEFT = 3;

export const REPEATED_ERROR_REMINDER =
  'A tool call has just failed with the same error as an earlier one. Making it again will fail the same way: try something different, or, if nothing else can work, call finish and say in your summary what is blocking you.';

export function stepsLeftReminder(stepsLeft: number): string {
  if (stepsLeft <= 1) {
    return 'This is the last step of the session. Call finish now, with your summary (what you changed and anything left to do, or that you could not check it) and the checks you made.';
  }
  return `You have ${String(stepsLeft)} steps left in this session, this one included. Wrap up: finish the change if it is not done, and call finish with your summary before the steps run out. A session that runs out of steps ends without your summary.`;
}

/** True when the latest tool results have an error exactly like an earlier one. */
function repeatsAnError(conversation: readonly ConversationEntry[]): boolean {
  const last = conversation.at(-1);
  if (last?.role !== 'tool') return false;
  const seen = new Set<string>();
  for (const entry of conversation.slice(0, -1)) {
    if (entry.role !== 'tool') continue;
    for (const result of entry.results) {
      if (result.isError) seen.add(`${result.toolName}\n${result.output}`);
    }
  }
  return last.results.some(
    (result) => result.isError && seen.has(`${result.toolName}\n${result.output}`),
  );
}

/** What to tell the model this step, after the conversation, or null for nothing. */
export function agentReminder({ conversation, stepsLeft }: ReminderContext): string | null {
  const reminders: string[] = [];
  if (repeatsAnError(conversation)) reminders.push(REPEATED_ERROR_REMINDER);
  if (stepsLeft <= REMIND_STEPS_LEFT) reminders.push(stepsLeftReminder(stepsLeft));
  return reminders.length === 0 ? null : reminders.join('\n\n');
}
