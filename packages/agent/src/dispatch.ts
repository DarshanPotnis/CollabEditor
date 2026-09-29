/**
 * From a tool call the model made to the result it reads next step. Whatever
 * the model sent, the answer is a tool result, never an exception in the loop:
 * an unknown tool or invalid input is explained so the model can correct
 * itself, and a ToolHost that throws is reported and answered as a failure.
 */
import {
  AGENT_TOOLS,
  AGENT_TOOL_NAMES,
  isAgentToolName,
  type AiFinishReason,
  type ToolCallPart,
  type ToolResult,
} from '@collabcode/shared';
import type { z } from 'zod';
import { MAX_TOOL_OUTPUT_CHARS } from './limits.js';
import { RUN_OUTPUT_TOOLS, truncateOutput, withStackTraceNote } from './tool-output.js';
import type { StopSignal, ToolCall, ToolHost } from './types.js';

export type ParsedCall = { ok: true; call: ToolCall } | { ok: false; message: string };

function describeIssues(issues: z.ZodError['issues']): string {
  return issues
    .slice(0, 3)
    .map(
      (issue) =>
        `${issue.path.length === 0 ? 'input' : issue.path.map(String).join('.')}: ${issue.message}`,
    )
    .join('; ');
}

/** Checks a call against its tool's schema, which is also what the model was shown. */
export function parseToolCall(
  part: Pick<ToolCallPart, 'toolName' | 'input'>,
  finishReason: AiFinishReason,
): ParsedCall {
  const name = part.toolName;
  if (!isAgentToolName(name)) {
    return {
      ok: false,
      message: `There is no tool named "${name}". The tools are: ${AGENT_TOOL_NAMES.join(', ')}.`,
    };
  }
  const parsed = AGENT_TOOLS[name].input.safeParse(part.input);
  if (!parsed.success) {
    const cutOff =
      finishReason === 'length'
        ? ' Your answer was cut off at the output limit, so make smaller changes.'
        : '';
    return {
      ok: false,
      message: `The input for ${name} is not valid: ${describeIssues(parsed.error.issues)}.${cutOff}`,
    };
  }
  // The schema for `name` produced `parsed.data`, so the two belong together.
  return { ok: true, call: { name, input: parsed.data } as ToolCall };
}

export type Dispatched = {
  result: ToolResult;
  /** False when the call could not be run at all: unknown tool or invalid input. */
  valid: boolean;
};

export type DispatchContext = {
  host: ToolHost;
  signal: StopSignal;
  finishReason: AiFinishReason;
  /** A ToolHost threw, which is a bug in it; the caller reports it. */
  onCrash: (error: unknown) => void;
};

function answer(part: ToolCallPart, isError: boolean, output: string): ToolResult {
  return { toolCallId: part.toolCallId, toolName: part.toolName, isError, output };
}

/** Runs one call that is not `finish`, which the loop handles itself. */
export async function dispatchToolCall(
  part: ToolCallPart,
  { host, signal, finishReason, onCrash }: DispatchContext,
): Promise<Dispatched> {
  const parsed = parseToolCall(part, finishReason);
  if (!parsed.ok) return { result: answer(part, true, parsed.message), valid: false };
  const { call } = parsed;
  if (call.name === 'finish') {
    return { result: answer(part, true, 'finish is handled by the session.'), valid: false };
  }

  try {
    const outcome = await host.execute(call, signal);
    const output = RUN_OUTPUT_TOOLS.has(call.name)
      ? withStackTraceNote(outcome.output)
      : outcome.output;
    return {
      result: answer(part, !outcome.ok, truncateOutput(output, MAX_TOOL_OUTPUT_CHARS)),
      valid: true,
    };
  } catch (error) {
    onCrash(error);
    return {
      result: answer(part, true, `${call.name} failed unexpectedly. Try another way.`),
      valid: true,
    };
  }
}
