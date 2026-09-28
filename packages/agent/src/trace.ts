/**
 * A session's trace: everything it did, as JSON (docs/PLAN-AI.md §7 AI-2).
 *
 * - Each model answer is kept verbatim, so a trace can be replayed with no
 *   model at all (scripted-model.ts): AI-5's "Watch a demo" and AI-4's
 *   regression examples feed the recorded answers to a real ToolHost.
 * - Replaying only makes sense on the project the session started from, so the
 *   trace records the template and a fingerprint of the starting files.
 * - It holds what the model saw and did, which is project code and output, and
 *   never a key: the core never has one (the ModelClient keeps it).
 *
 * The format is versioned and validated when read back, since a trace file is
 * as untrusted as any other input.
 */
import {
  AI_FINISH_REASONS,
  AI_PROVIDERS,
  PROMPT_IDS,
  assistantMessageSchema,
  type AgentTier,
} from '@collabcode/shared';
import { z } from 'zod';
import type { AgentLimits } from './limits.js';
import type { RetryWait } from './model-retry.js';
import type { AgentInputs, ModelStep } from './types.js';

export const TRACE_FORMAT = 'collabcode-agent-trace';
export const TRACE_VERSION = 1;

export const agentOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('finished'), summary: z.string() }),
  z.object({ kind: z.literal('stopped') }),
  z.object({
    kind: z.literal('limit'),
    limit: z.enum(['steps', 'time', 'tokens', 'conversation']),
    message: z.string(),
  }),
  z.object({
    kind: z.literal('failed'),
    reason: z.enum(['model', 'invalid-calls', 'no-tool-call', 'crashed']),
    message: z.string(),
  }),
]);
export type AgentOutcome = z.infer<typeof agentOutcomeSchema>;

const tokenCount = z.number().int().nonnegative().nullable();

const traceToolCallSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  isError: z.boolean(),
  output: z.string(),
  startedAtMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type TraceToolCall = z.infer<typeof traceToolCallSchema>;

const traceStepSchema = z.object({
  index: z.number().int().positive(),
  startedAtMs: z.number().nonnegative(),
  waits: z.array(
    z.object({ reason: z.enum(['busy', 'rate-limited']), waitMs: z.number().nonnegative() }),
  ),
  /** Null when the model call failed. */
  model: z
    .object({
      provider: z.enum(AI_PROVIDERS),
      id: z.string(),
      durationMs: z.number().nonnegative(),
      finishReason: z.enum(AI_FINISH_REASONS),
      usage: z.object({ inputTokens: tokenCount, outputTokens: tokenCount }),
      message: assistantMessageSchema,
    })
    .nullable(),
  toolCalls: z.array(traceToolCallSchema),
  /** The model answered without a tool call and was reminded to use one. */
  nudged: z.boolean(),
});
export type TraceStep = z.infer<typeof traceStepSchema>;

const totalsSchema = z.object({
  steps: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type AgentTotals = z.infer<typeof totalsSchema>;

export const agentTraceSchema = z.object({
  format: z.literal(TRACE_FORMAT),
  version: z.literal(TRACE_VERSION),
  sessionId: z.string(),
  /** Milliseconds since the epoch. */
  startedAt: z.number(),
  project: z.object({ template: z.string().nullable(), filesFingerprint: z.string() }),
  inputs: z.object({
    goal: z.string(),
    files: z.array(z.string()),
    moreFiles: z.number().int().nonnegative(),
  }),
  prompt: z.object({ id: z.enum(PROMPT_IDS), version: z.number().int().positive() }).nullable(),
  tier: z.enum(['shared', 'ownKey']),
  limits: z.object({
    maxSteps: z.number(),
    maxMs: z.number(),
    maxInputTokens: z.number(),
    maxToolCallsPerStep: z.number(),
    maxConversationChars: z.number(),
  }),
  steps: z.array(traceStepSchema),
  outcome: agentOutcomeSchema.nullable(),
  totals: totalsSchema,
});
export type AgentTrace = z.infer<typeof agentTraceSchema>;

/** A trace read from a file, or null when it is not one this version understands. */
export function parseTrace(raw: unknown): AgentTrace | null {
  const parsed = agentTraceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type TraceStart = {
  sessionId: string;
  startedAt: number;
  project: AgentTrace['project'];
  inputs: AgentInputs;
  tier: AgentTier;
  limits: AgentLimits;
};

export type TraceRecorder = {
  startStep: (index: number, atMs: number) => void;
  recordWait: (wait: RetryWait) => void;
  recordModel: (step: ModelStep, durationMs: number) => void;
  recordNudge: () => void;
  recordToolCall: (call: TraceToolCall) => void;
  finish: (outcome: AgentOutcome, totals: AgentTotals) => void;
  /** A copy, safe to serialise and keep. */
  snapshot: () => AgentTrace;
};

export function createTraceRecorder(start: TraceStart): TraceRecorder {
  const trace: AgentTrace = {
    format: TRACE_FORMAT,
    version: TRACE_VERSION,
    sessionId: start.sessionId,
    startedAt: start.startedAt,
    project: start.project,
    inputs: {
      goal: start.inputs.goal,
      files: [...start.inputs.files],
      moreFiles: start.inputs.moreFiles ?? 0,
    },
    prompt: null,
    tier: start.tier,
    limits: { ...start.limits },
    steps: [],
    outcome: null,
    totals: { steps: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 },
  };
  const current = (): TraceStep | undefined => trace.steps.at(-1);

  return {
    startStep(index, atMs) {
      trace.steps.push({
        index,
        startedAtMs: atMs,
        waits: [],
        model: null,
        toolCalls: [],
        nudged: false,
      });
    },
    recordWait(wait) {
      current()?.waits.push({ ...wait });
    },
    recordModel(step, durationMs) {
      trace.prompt ??= agentPromptOf(step);
      const entry = current();
      if (!entry) return;
      entry.model = {
        provider: step.model.provider,
        id: step.model.id,
        durationMs,
        finishReason: step.finishReason,
        usage: { ...step.usage },
        message: step.message,
      };
    },
    recordNudge() {
      const entry = current();
      if (entry) entry.nudged = true;
    },
    recordToolCall(call) {
      current()?.toolCalls.push(call);
    },
    finish(outcome, totals) {
      trace.outcome = outcome;
      trace.totals = { ...totals };
    },
    snapshot() {
      // Through JSON, as the trace will be written: nothing shared, nothing undefined.
      return agentTraceSchema.parse(JSON.parse(JSON.stringify(trace)));
    },
  };
}

function agentPromptOf(step: ModelStep): AgentTrace['prompt'] {
  const id = PROMPT_IDS.find((known) => known === step.prompt.id);
  return id === undefined ? null : { id, version: step.prompt.version };
}
