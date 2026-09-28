/**
 * The agent loop (docs/PLAN-AI.md §5):
 *
 *   until finish, a limit, a failure or Stop:
 *     1. ask the model for its next step, with the conversation so far
 *     2. carry out each tool call it made, through the ToolHost
 *     3. add the model's message and the results to the conversation
 *
 * It knows nothing about browsers, sockets or processes: the ModelClient and
 * the ToolHost do, so the same loop runs in the app and in the evals. It never
 * throws for anything the model does; every way a session ends is an outcome,
 * recorded in the trace.
 */
import {
  AGENT_TOOLS,
  conversationChars,
  toolCallsOf,
  type AgentTier,
  type ConversationEntry,
  type ToolResult,
} from '@collabcode/shared';
import { fitConversation } from './conversation-fit.js';
import { dispatchToolCall } from './dispatch.js';
import type { AgentEvent } from './events.js';
import { AGENT_LIMITS, MAX_INVALID_STEPS, type AgentLimits } from './limits.js';
import { stepWithRetries } from './model-retry.js';
import { createStopSource, stopOnAny } from './stop-source.js';
import { createTraceRecorder, type AgentOutcome, type AgentTrace } from './trace.js';
import {
  ModelStepError,
  type AgentInputs,
  type Clock,
  type ModelClient,
  type ModelStep,
  type StopSignal,
  type ToolHost,
} from './types.js';

export type AgentRunOptions = {
  sessionId: string;
  inputs: AgentInputs;
  tier: AgentTier;
  /** Defaults to the tier's. */
  limits?: AgentLimits;
  model: ModelClient;
  tools: ToolHost;
  clock: Clock;
  /** The person's Stop button. */
  stop: StopSignal;
  /** Which project the session starts from, for the trace. */
  project: AgentTrace['project'];
  onEvent?: (event: AgentEvent) => void;
  /** For jitter; Math.random unless a test needs it fixed. */
  random?: () => number;
};

export type AgentRunResult = {
  outcome: AgentOutcome;
  trace: AgentTrace;
  /** As it stood at the end, for tests and the evals. */
  conversation: ConversationEntry[];
};

/** A rough count for a provider that reports no usage: about four characters a token. */
function estimatedTokens(entries: readonly ConversationEntry[]): number {
  return Math.ceil(conversationChars(entries) / 4);
}

function minutes(ms: number): string {
  const count = Math.round(ms / 60_000);
  return count === 1 ? '1 minute' : `${String(count)} minutes`;
}

export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const limits = options.limits ?? AGENT_LIMITS[options.tier];
  const { clock, inputs } = options;
  const emit = options.onEvent ?? ((): void => undefined);
  const random = options.random ?? Math.random;
  const startedAt = clock.now();
  const deadline = startedAt + limits.maxMs;

  // Stopping, for everything the session starts: the person's Stop or the time limit.
  const timeUp = createStopSource();
  const session = stopOnAny([options.stop, timeUp.signal]);
  const ended = createStopSource();
  const timer = stopOnAny([session.signal, ended.signal]);
  void clock.sleep(limits.maxMs, timer.signal).then(() => {
    if (!timer.signal.aborted) timeUp.stop();
  });

  const trace = createTraceRecorder({
    sessionId: options.sessionId,
    startedAt,
    project: options.project,
    inputs,
    tier: options.tier,
    limits,
  });
  let conversation: ConversationEntry[] = [];
  const totals = { steps: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };

  const end = (outcome: AgentOutcome): AgentRunResult => {
    ended.stop();
    timer.dispose();
    session.dispose();
    totals.durationMs = clock.now() - startedAt;
    trace.finish(outcome, totals);
    emit({ type: 'finished', outcome, totals: { ...totals } });
    return { outcome, trace: trace.snapshot(), conversation };
  };
  const interrupted = (): AgentOutcome =>
    options.stop.aborted
      ? { kind: 'stopped' }
      : {
          kind: 'limit',
          limit: 'time',
          message: `The session reached its time limit of ${minutes(limits.maxMs)}.`,
        };

  let nudgedLastStep = false;
  let invalidSteps = 0;

  for (let step = 1; step <= limits.maxSteps; step += 1) {
    if (session.signal.aborted) return end(interrupted());
    if (totals.inputTokens >= limits.maxInputTokens) {
      return end({
        kind: 'limit',
        limit: 'tokens',
        message: `The session used its ${limits.maxInputTokens.toLocaleString('en-US')} input tokens.`,
      });
    }
    const fitted = fitConversation(conversation, limits.maxConversationChars);
    if (fitted === null) {
      return end({
        kind: 'limit',
        limit: 'conversation',
        message: 'The conversation grew too long for the AI to continue.',
      });
    }
    conversation = fitted;

    trace.startStep(step, clock.now() - startedAt);
    emit({ type: 'step-started', step, maxSteps: limits.maxSteps });
    let answer: ModelStep;
    let attemptMs: number;
    try {
      ({ step: answer, attemptMs } = await stepWithRetries({
        client: options.model,
        request: {
          inputs,
          // A copy: this one grows once the model has answered.
          conversation: [...conversation],
          signal: session.signal,
          onText: (delta) => emit({ type: 'text', step, delta }),
        },
        clock,
        random,
        deadline,
        onWait: (wait) => {
          trace.recordWait(wait);
          emit({ type: 'waiting', step, reason: wait.reason, waitMs: wait.waitMs });
        },
      }));
    } catch (error) {
      if (session.signal.aborted) return end(interrupted());
      if (error instanceof ModelStepError) {
        return end({ kind: 'failed', reason: 'model', message: error.message });
      }
      emit({ type: 'crashed', where: 'model', error });
      return end({
        kind: 'failed',
        reason: 'crashed',
        message: 'Something went wrong while asking the AI. Try again.',
      });
    }

    totals.steps = step;
    totals.inputTokens += answer.usage.inputTokens ?? estimatedTokens(conversation);
    totals.outputTokens += answer.usage.outputTokens ?? 0;
    conversation.push(answer.message);
    trace.recordModel(answer, attemptMs);
    emit({
      type: 'model-answered',
      step,
      finishReason: answer.finishReason,
      usage: answer.usage,
      model: answer.model,
      remainingToday: answer.remainingToday,
    });

    const calls = toolCallsOf(answer.message);
    if (calls.length === 0) {
      if (nudgedLastStep) {
        return end({
          kind: 'failed',
          reason: 'no-tool-call',
          message:
            'The AI stopped using its tools without finishing. Try again, or a stronger model.',
        });
      }
      nudgedLastStep = true;
      conversation.push({ role: 'nudge' });
      trace.recordNudge();
      continue;
    }
    nudgedLastStep = false;

    const results: ToolResult[] = [];
    let ranOne = false;
    for (const [index, call] of calls.entries()) {
      if (session.signal.aborted) return end(interrupted());
      const toolStarted = clock.now();
      emit({
        type: 'tool-started',
        step,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      });

      let result: ToolResult;
      if (call.toolName === 'finish') {
        const finish = AGENT_TOOLS.finish.input.safeParse(call.input);
        if (finish.success) {
          trace.recordToolCall({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
            isError: false,
            output: '',
            startedAtMs: toolStarted - startedAt,
            durationMs: 0,
          });
          return end({ kind: 'finished', summary: finish.data.summary });
        }
        result = {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          isError: true,
          output: 'finish needs a summary for the person: what you changed and how you checked it.',
        };
      } else if (index >= limits.maxToolCallsPerStep) {
        result = {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          isError: true,
          output: `Skipped: at most ${String(limits.maxToolCallsPerStep)} tool calls are carried out per step. Make this call again in your next step.`,
        };
      } else {
        const dispatched = await dispatchToolCall(call, {
          host: options.tools,
          signal: session.signal,
          finishReason: answer.finishReason,
          onCrash: (error) => emit({ type: 'crashed', where: 'tool', error }),
        });
        ranOne ||= dispatched.valid;
        result = dispatched.result;
      }

      results.push(result);
      const durationMs = clock.now() - toolStarted;
      trace.recordToolCall({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        isError: result.isError,
        output: result.output,
        startedAtMs: toolStarted - startedAt,
        durationMs,
      });
      emit({
        type: 'tool-finished',
        step,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        isError: result.isError,
        output: result.output,
        durationMs,
      });
    }
    conversation.push({ role: 'tool', results });

    invalidSteps = ranOne ? 0 : invalidSteps + 1;
    if (invalidSteps >= MAX_INVALID_STEPS) {
      return end({
        kind: 'failed',
        reason: 'invalid-calls',
        message:
          'The AI kept making tool calls that could not be carried out. Try again, or a stronger model.',
      });
    }
  }

  return end({
    kind: 'limit',
    limit: 'steps',
    message: `The session used all ${String(limits.maxSteps)} steps without finishing.`,
  });
}
