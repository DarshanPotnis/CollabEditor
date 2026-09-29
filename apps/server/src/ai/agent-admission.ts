/**
 * How AI agent sessions fit the shared free tier (docs/PLAN-AI.md §6.1).
 *
 * Every step is one model call and is counted like any other request, since
 * that is what Google counts. On top of that, and still without the server
 * keeping any session state:
 *
 * - a session may take at most AGENT_STEP_LIMITS steps for its tier, counted
 *   from the conversation it sends;
 * - a shared-tier session starts only when the visitor and the project could
 *   pay for every step, and everyone together would still have a reserve left
 *   for the one-shot helpers. A session never starts that its own allowance
 *   could not finish.
 *
 * Starting over with an empty conversation only spends the caller's own
 * allowance again, so the step cap does not need to be tamper-proof.
 */
import { AGENT_STEP_LIMITS, type AgentTier, type ApiErrorCode } from '@collabcode/shared';
import type { Remaining } from './daily-limits.js';

/** Shared-tier requests an agent session may not eat into, kept for the one-shot helpers. */
export const HELPER_RESERVE = 40;

export type AgentAdmission = { ok: true } | { ok: false; code: ApiErrorCode; message: string };

export type AgentStep = {
  tier: AgentTier;
  /** Steps the session has already taken: the model answers in its conversation. */
  stepsTaken: number;
  /** Read only for the first shared-tier step. */
  remaining: () => Remaining;
};

const RESET = 'They reset at midnight Pacific time, or add your own key in AI settings.';

export function admitAgentStep({ tier, stepsTaken, remaining }: AgentStep): AgentAdmission {
  const cap = AGENT_STEP_LIMITS[tier];
  if (stepsTaken >= cap) {
    return {
      ok: false,
      code: 'quota-exhausted',
      message:
        tier === 'shared'
          ? `An AI teammate session on the shared free tier can take at most ${String(cap)} steps. Add your own key in AI settings for longer sessions.`
          : `An AI teammate session can take at most ${String(cap)} steps.`,
    };
  }
  if (tier === 'ownKey' || stepsTaken > 0) return { ok: true };

  const left = remaining();
  if (left.ip < cap) {
    return {
      ok: false,
      code: 'quota-exhausted',
      message: `An AI teammate session needs ${String(cap)} of your shared free AI requests, and you have ${String(left.ip)} left today. ${RESET}`,
    };
  }
  if (left.project < cap) {
    return {
      ok: false,
      code: 'quota-exhausted',
      message: `An AI teammate session needs ${String(cap)} shared free AI requests, and this project has ${String(left.project)} left today. ${RESET}`,
    };
  }
  if (left.global < cap + HELPER_RESERVE) {
    return {
      ok: false,
      code: 'quota-exhausted',
      message: `Too few of today's shared free AI requests are left for everyone together to start an AI teammate session. The one-shot helpers still work. ${RESET}`,
    };
  }
  return { ok: true };
}
