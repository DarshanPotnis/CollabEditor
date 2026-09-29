/**
 * Made-up sessions for the graders' unit tests: a trace of one tool call per
 * step, and a grading context around it with files but no sandbox.
 */
import type { AgentOutcome, AgentTrace, TraceToolCall } from '@collabcode/agent';
import type { GradeContext, Grader } from './grader.js';

export function call(
  toolName: string,
  input: unknown,
  output = '',
  isError = false,
): TraceToolCall {
  return { toolCallId: 'c', toolName, input, isError, output, startedAtMs: 0, durationMs: 0 };
}

export const edited = call('edit_file', { path: 'routes/users.js' }, 'Edited routes/users.js.');

export const request = (method: string, path: string, status: number, body?: unknown) =>
  call(
    'http_request',
    { method, path, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    `HTTP ${String(status)} OK, 3 ms`,
  );

export const finishedWith = (summary: string): AgentOutcome => ({
  kind: 'finished',
  summary,
  checks: null,
});

/** A session of one step per call, ending as `outcome`. */
export function traceOf(calls: TraceToolCall[], outcome: AgentOutcome): AgentTrace {
  return {
    format: 'collabcode-agent-trace',
    version: 4,
    sessionId: 's',
    startedAt: 0,
    project: { template: 'express-api', filesFingerprint: 'fp' },
    inputs: { goal: 'g', files: [], moreFiles: 0 },
    prompt: { id: 'agent', version: 3 },
    tier: 'shared',
    limits: {
      maxSteps: 15,
      maxMs: 1,
      maxInputTokens: 1,
      maxToolCallsPerStep: 8,
      maxConversationChars: 1,
    },
    steps: calls.map((toolCall, index) => ({
      index: index + 1,
      startedAtMs: 0,
      waits: [],
      model: null,
      toolCalls: [toolCall],
      nudged: false,
      reminder: null,
    })),
    outcome,
    totals: { steps: calls.length, inputTokens: 0, outputTokens: 0, durationMs: 0 },
  };
}

export function context(
  trace: AgentTrace,
  initial: Record<string, string> = {},
  final: Record<string, string> = initial,
): GradeContext {
  const unused = (): never => {
    throw new Error('this grader needs no sandbox');
  };
  return {
    trace,
    initialFiles: new Map(Object.entries(initial)),
    finalFiles: new Map(Object.entries(final)),
    sandbox: unused,
    sandboxWith: unused,
  };
}

export async function verdict(grader: Grader, ctx: GradeContext) {
  const { passed, detail, category } = await grader.grade(ctx);
  return { passed, detail, category: category ?? grader.category };
}
