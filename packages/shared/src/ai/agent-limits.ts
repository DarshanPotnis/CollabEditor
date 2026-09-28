/**
 * How many steps (model calls) one AI agent session may take. The agent core
 * stops there, the panel shows it, and the server refuses a step beyond it.
 * The shared free tier gets fewer: a visitor has 30 free requests a day, and a
 * session is admitted only when it could take all of its steps
 * (apps/server/src/ai/agent-admission.ts).
 */
export const AGENT_STEP_LIMITS = { shared: 15, ownKey: 25 } as const;

export type AgentTier = keyof typeof AGENT_STEP_LIMITS;
