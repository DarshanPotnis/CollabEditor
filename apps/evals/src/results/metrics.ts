/**
 * What one session cost and how it went, from its trace (docs/evals/README.md):
 *
 * - requests: every model attempt, the busy and rate-limited ones included,
 *   since the free tier counts them all (a step's retries are its waits);
 * - wall time, and within it the model's time, the tools' and the waits';
 * - wasted steps: steps where every tool call failed (like edits whose text
 *   was not in the file) or that called no tool at all;
 * - repeated errors: steps the model was reminded not to repeat a failure;
 * - refused finishes: finish calls the loop sent back (no summary, or checks
 *   the session did not make), and the checks a finish listed but did not
 *   make (agent@4 on; zero before);
 * - checks after the last change: answered requests, and commands that ran
 *   to an exit code, after the session's last change to the project.
 */
import { REPEATED_ERROR_REMINDER } from '@collabcode/shared';
import type { AgentTrace } from '@collabcode/agent';

export type TaskMetrics = {
  steps: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  wallMs: number;
  modelMs: number;
  toolMs: number;
  waitMs: number;
  wastedSteps: number;
  repeatedErrors: number;
  /** Absent from results recorded before they were measured. */
  refusedFinishes?: number;
  checksNotMade?: number;
  checksAfterLastChange?: number;
};

type Call = AgentTrace['steps'][number]['toolCalls'][number];

const FILE_CHANGING_TOOLS: ReadonlySet<string> = new Set([
  'edit_file',
  'create_file',
  'rename_file',
  'delete_file',
]);

/** A check that happened: a request that got an answer, or a command that exited, passing or not. */
function isCheck(call: Call): boolean {
  if (call.toolName === 'http_request') return !call.isError;
  if (call.toolName === 'run_command') return / exited with code -?\d+ after /.test(call.output);
  return false;
}

function checksAfterLastChange(calls: readonly Call[]): number {
  const last = calls.findLastIndex(
    (call) => FILE_CHANGING_TOOLS.has(call.toolName) && !call.isError,
  );
  return calls.slice(last + 1).filter(isCheck).length;
}

export function metricsOf(trace: AgentTrace): TaskMetrics {
  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
  return {
    steps: trace.steps.length,
    requests: sum(trace.steps.map((step) => step.waits.length + 1)),
    inputTokens: trace.totals.inputTokens,
    outputTokens: trace.totals.outputTokens,
    wallMs: trace.totals.durationMs,
    modelMs: sum(trace.steps.map((step) => step.model?.durationMs ?? 0)),
    toolMs: sum(trace.steps.flatMap((step) => step.toolCalls.map((call) => call.durationMs))),
    waitMs: sum(trace.steps.flatMap((step) => step.waits.map((wait) => wait.waitMs))),
    wastedSteps: trace.steps.filter(
      (step) =>
        step.model !== null &&
        (step.toolCalls.length === 0 || step.toolCalls.every((call) => call.isError)),
    ).length,
    repeatedErrors: trace.steps.filter((step) => step.reminder?.includes(REPEATED_ERROR_REMINDER))
      .length,
    refusedFinishes: trace.steps
      .flatMap((step) => step.toolCalls)
      .filter((call) => call.toolName === 'finish' && call.isError).length,
    checksNotMade:
      trace.outcome?.kind === 'finished' ? (trace.outcome.checks?.notMade.length ?? 0) : 0,
    checksAfterLastChange: checksAfterLastChange(trace.steps.flatMap((step) => step.toolCalls)),
  };
}
