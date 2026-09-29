/**
 * A trace as a timeline for the trace viewer (docs/PLAN-AI.md, AI-5): a header
 * with the goal and what ran, then each step's model call (latency, tokens,
 * finish reason, waits, reminder, nudge, its words) and tool calls (input,
 * output, error or not, duration), then how it ended, with the summary and the
 * checks its finish listed. Any format parseTrace reads works: what an older
 * one did not record says so. Long inputs and outputs are cut, with how much
 * was left out; everything stays text.
 */
import type { AgentTrace } from '@collabcode/agent';
import { checksLines } from './checks-text.js';

export const INPUT_CHARS = 600;
export const OUTPUT_CHARS = 1_500;

export type TimelineCall = {
  name: string;
  input: string;
  output: string;
  isError: boolean;
  duration: string;
};

export type TimelineStep = {
  index: number;
  model: string;
  waits: string[];
  reminder: string | null;
  nudged: boolean;
  text: string | null;
  calls: TimelineCall[];
};

export type Timeline = {
  header: { goal: string; lines: string[] };
  steps: TimelineStep[];
  end: {
    outcome: string;
    summary: string | null;
    /** Null when the session did not finish, or the format did not record them. */
    checks: { made: string[]; notMade: string[] } | null;
  };
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const count = (value: number): string => value.toLocaleString('en-US');

/** At most `max` characters, and how many more there were. */
export function cut(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}…\n(${count(text.length - max)} more characters)`;
}

function inputText(input: unknown): string {
  const text = typeof input === 'string' ? input : (JSON.stringify(input, null, 2) ?? '');
  return cut(text, INPUT_CHARS);
}

function modelLine(model: NonNullable<AgentTrace['steps'][number]['model']>): string {
  const { inputTokens, outputTokens } = model.usage;
  const tokens =
    inputTokens === null && outputTokens === null
      ? 'tokens not reported'
      : `${inputTokens === null ? '?' : count(inputTokens)} in, ${outputTokens === null ? '?' : count(outputTokens)} out`;
  const reason =
    model.rawFinishReason === null
      ? model.finishReason
      : `${model.finishReason} (${model.rawFinishReason})`;
  return `${model.provider}/${model.id} · ${seconds(model.durationMs)} · ${tokens} · ${reason}`;
}

function waitLine(wait: AgentTrace['steps'][number]['waits'][number]): string {
  const kind = wait.reason === 'busy' ? 'Busy' : 'Rate-limited';
  const attempt =
    wait.attemptMs === null
      ? 'the attempt’s own time was not recorded'
      : `after an attempt of ${seconds(wait.attemptMs)}`;
  return `${kind}: waited ${seconds(wait.waitMs)} (${attempt})`;
}

function outcomeLine(outcome: AgentTrace['outcome']): string {
  switch (outcome?.kind) {
    case undefined:
      return 'It did not end: the trace was saved while it ran.';
    case 'finished':
      return 'Finished';
    case 'stopped':
      return 'Stopped by the person';
    case 'limit':
    case 'failed':
      return outcome.message;
  }
}

export function traceTimeline(trace: AgentTrace): Timeline {
  const model = trace.steps.find((step) => step.model !== null)?.model;
  const prompt =
    trace.prompt === null
      ? 'prompt not recorded'
      : `${trace.prompt.id}@${String(trace.prompt.version)}`;
  const started = new Date(trace.startedAt).toISOString();
  const tokens = trace.totals.inputTokens + trace.totals.outputTokens;
  const outcome = trace.outcome;
  return {
    header: {
      goal: trace.inputs.goal,
      lines: [
        `${prompt} · ${model ? `${model.provider}/${model.id}` : 'no model answered'} · ${trace.tier === 'shared' ? 'shared' : 'own key'} tier (up to ${String(trace.limits.maxSteps)} steps)`,
        `Started ${started.slice(0, 10)} ${started.slice(11, 16)} UTC · ${String(trace.totals.steps)} steps · ${count(tokens)} tokens · ${seconds(trace.totals.durationMs)}`,
        `Project: ${trace.project.template === null ? 'not from a template' : `the ${trace.project.template} template`}${trace.inputs.sandbox === 'unavailable' ? ' · the page could not run code' : ''}`,
      ],
    },
    steps: trace.steps.map((step) => ({
      index: step.index,
      model: step.model === null ? 'The model did not answer' : modelLine(step.model),
      waits: step.waits.map(waitLine),
      reminder: step.reminder,
      nudged: step.nudged,
      text: (() => {
        const words = (step.model?.message.parts ?? [])
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('\n')
          .trim();
        return words === '' ? null : cut(words, OUTPUT_CHARS);
      })(),
      calls: step.toolCalls.map((call) => ({
        name: call.toolName,
        input: inputText(call.input),
        output: cut(call.output, OUTPUT_CHARS),
        isError: call.isError,
        duration: seconds(call.durationMs),
      })),
    })),
    end: {
      outcome: outcomeLine(outcome),
      summary: outcome?.kind === 'finished' ? outcome.summary : null,
      checks:
        outcome?.kind === 'finished' && outcome.checks !== null
          ? checksLines(outcome.checks)
          : null,
    },
  };
}
