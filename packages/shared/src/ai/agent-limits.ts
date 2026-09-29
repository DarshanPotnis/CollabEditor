/**
 * How many steps (model calls) one AI agent session may take. The agent core
 * stops there, the panel shows it, and the server refuses a step beyond it.
 * The shared free tier gets fewer: a visitor has 30 free requests a day, and a
 * session is admitted only when it could take all of its steps
 * (apps/server/src/ai/agent-admission.ts).
 */
import { conversationSteps, type ConversationEntry } from './conversation.js';

export const AGENT_STEP_LIMITS = { shared: 15, ownKey: 25 } as const;

export type AgentTier = keyof typeof AGENT_STEP_LIMITS;

/**
 * Steps a session may still take, the one being asked for included, which is
 * what the reminders (prompts/agent-reminders.ts) go by. The server and the
 * evals both count it this way, from the conversation and the tier's cap.
 */
export function stepsLeftFor(tier: AgentTier, conversation: readonly ConversationEntry[]): number {
  return AGENT_STEP_LIMITS[tier] - conversationSteps(conversation);
}
