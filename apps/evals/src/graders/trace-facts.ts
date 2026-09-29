/**
 * Facts read from a session's trace, which the trace graders judge: the tool
 * calls in order, where the last change to the project was, and the HTTP
 * requests the agent sent with the statuses it saw.
 */
import type { AgentTrace, TraceToolCall } from '@collabcode/agent';

/** Tools whose success changes the project's files. */
export const FILE_CHANGING_TOOLS: ReadonlySet<string> = new Set([
  'edit_file',
  'create_file',
  'rename_file',
  'delete_file',
]);

export const RUN_TOOLS: ReadonlySet<string> = new Set([
  'run_project',
  'run_command',
  'http_request',
]);

export function toolCalls(trace: AgentTrace): TraceToolCall[] {
  return trace.steps.flatMap((step) => step.toolCalls);
}

/** Index of the last call that changed the project, or -1 when none did. */
export function lastChangeIndex(calls: readonly TraceToolCall[]): number {
  return calls.findLastIndex((call) => FILE_CHANGING_TOOLS.has(call.toolName) && !call.isError);
}

export type SentRequest = {
  method: string;
  path: string;
  /** The body as sent, parsed as JSON when it is JSON. */
  body: unknown;
  /** The status the agent saw, or null when the request did not get an answer. */
  status: number | null;
};

function parsedBody(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Not JSON: the grader sees the text as sent.
    return raw;
  }
}

/** The HTTP requests among `calls`, with what the agent was told they answered. */
export function sentRequests(calls: readonly TraceToolCall[]): SentRequest[] {
  return calls
    .filter((call) => call.toolName === 'http_request')
    .map((call) => {
      const input = (call.input ?? {}) as { method?: unknown; path?: unknown; body?: unknown };
      const status = /^HTTP (\d{3}) /.exec(call.output)?.[1];
      return {
        method: typeof input.method === 'string' ? input.method : '',
        path: typeof input.path === 'string' ? input.path : '',
        body: parsedBody(input.body),
        status: status === undefined ? null : Number(status),
      };
    });
}

/** The finish summary, or '' when the session did not finish. */
export function summaryOf(trace: AgentTrace): string {
  return trace.outcome?.kind === 'finished' ? trace.outcome.summary : '';
}
