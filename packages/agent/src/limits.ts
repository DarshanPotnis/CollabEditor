/**
 * What bounds one agent session (docs/PLAN-AI.md §5), by tier. The panel shows
 * them; the server enforces the step cap and the conversation size as well.
 */
import { AGENT_STEP_LIMITS, CONVERSATION_LIMITS, type AgentTier } from '@collabcode/shared';

export type AgentLimits = {
  /** Model calls. */
  maxSteps: number;
  /** Wall-clock time, waits for a busy model included. */
  maxMs: number;
  /** Input tokens over the whole session: every step resends the conversation. */
  maxInputTokens: number;
  /** Tool calls carried out from one model answer; the rest are answered "skipped". */
  maxToolCallsPerStep: number;
  /** Characters the model reads, the same measure the server caps. */
  maxConversationChars: number;
};

export const AGENT_LIMITS: Readonly<Record<AgentTier, AgentLimits>> = {
  shared: {
    maxSteps: AGENT_STEP_LIMITS.shared,
    maxMs: 5 * 60_000,
    maxInputTokens: 400_000,
    maxToolCallsPerStep: 8,
    maxConversationChars: CONVERSATION_LIMITS.chars,
  },
  ownKey: {
    maxSteps: AGENT_STEP_LIMITS.ownKey,
    maxMs: 5 * 60_000,
    maxInputTokens: 1_000_000,
    maxToolCallsPerStep: 8,
    maxConversationChars: CONVERSATION_LIMITS.chars,
  },
};

/** Retrying a model that was busy before answering: two more tries, then give up. */
export const BUSY_RETRY_DELAYS_MS = [5_000, 15_000] as const;

/** How long to wait on a rate limit that does not say. */
export const DEFAULT_RATE_LIMIT_WAIT_MS = 20_000;

/** Waits in a row on rate limits before giving up on a step. */
export const MAX_RATE_LIMIT_WAITS = 3;

/** Model answers in a row whose every tool call was invalid, before giving up. */
export const MAX_INVALID_STEPS = 3;

/** One tool result, before it is cut off with a marker. */
export const MAX_TOOL_OUTPUT_CHARS = 12_000;
