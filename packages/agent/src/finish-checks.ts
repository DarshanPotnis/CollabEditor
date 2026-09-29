/**
 * finish's checks, held against what the session did (docs/decisions/012).
 *
 * The model lists the checks it made after its last change: requests with the
 * status each got, commands with their exit code. A listed check counts as
 * made when a call after the session's last change to the project matches it:
 * an answered http_request with the same method and path, whose answer had
 * that status, or a run_command with that command line that exited with that
 * code. The loop refuses a finish that lists a check not made, once; after
 * that (or on the last step) it accepts it, with those checks set apart as not
 * made, so the person never sees a check as done that was not.
 */
import { AGENT_TOOLS, type AgentToolInput } from '@collabcode/shared';
import { z } from 'zod';
import { answeredStatus, exitCodeOf } from './runtime/run-text.js';
import type { TraceToolCall } from './trace.js';

export const listedCheckSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('request'),
    method: z.string(),
    path: z.string(),
    status: z.number().int(),
  }),
  z.object({ kind: z.literal('command'), command: z.string(), exitCode: z.number().int() }),
]);
export type ListedCheck = z.infer<typeof listedCheckSchema>;

export const verifiedChecksSchema = z.object({
  made: z.array(listedCheckSchema),
  notMade: z.array(z.object({ check: listedCheckSchema, reason: z.string() })),
});
export type VerifiedChecks = z.infer<typeof verifiedChecksSchema>;
export type NotMadeCheck = VerifiedChecks['notMade'][number];

/** Tools whose success changes the project's files. */
const FILE_CHANGING_TOOLS: ReadonlySet<string> = new Set([
  'edit_file',
  'create_file',
  'rename_file',
  'delete_file',
]);

/** finish's two lists as one, requests first; a list the model left out is empty. */
export function listedChecks(input: AgentToolInput<'finish'>): ListedCheck[] {
  return [
    ...(input.checkedRequests ?? []).map((request): ListedCheck => ({
      kind: 'request',
      ...request,
    })),
    ...(input.checkedCommands ?? []).map((command): ListedCheck => ({
      kind: 'command',
      ...command,
    })),
  ];
}

const oneSpaced = (text: string): string => text.trim().replace(/\s+/g, ' ');

function commandLine(call: TraceToolCall): string {
  const input = AGENT_TOOLS.run_command.input.safeParse(call.input);
  return input.success ? oneSpaced([input.data.command, ...input.data.args].join(' ')) : '';
}

function requestOf(call: TraceToolCall): { method: string; path: string } | null {
  const input = AGENT_TOOLS.http_request.input.safeParse(call.input);
  return input.success ? { method: input.data.method, path: input.data.path } : null;
}

/** What each call like `check` got, in order: a status, or an exit code. */
function outcomesOf(check: ListedCheck, calls: readonly TraceToolCall[]): number[] {
  if (check.kind === 'request') {
    return calls.flatMap((call) => {
      if (call.toolName !== 'http_request' || call.isError) return [];
      const request = requestOf(call);
      const status = answeredStatus(call.output);
      return request?.method === check.method.toUpperCase() &&
        request.path === check.path &&
        status !== null
        ? [status]
        : [];
    });
  }
  const line = oneSpaced(check.command);
  return calls.flatMap((call) => {
    if (call.toolName !== 'run_command' || commandLine(call) !== line) return [];
    const code = exitCodeOf(call.output, line);
    return code === null ? [] : [code];
  });
}

const expected = (check: ListedCheck): number =>
  check.kind === 'request' ? check.status : check.exitCode;

function reasonNotMade(check: ListedCheck, after: number[], before: number[]): string {
  const other = after.at(-1);
  if (other !== undefined) {
    return check.kind === 'request' ? `it got ${String(other)}` : `it exited with ${String(other)}`;
  }
  if (before.length > 0) {
    return check.kind === 'request'
      ? 'sent before your last change'
      : 'run before your last change';
  }
  return check.kind === 'request' ? 'not sent' : 'not run';
}

export function verifyChecks(
  listed: readonly ListedCheck[],
  calls: readonly TraceToolCall[],
): VerifiedChecks {
  const lastChange = calls.findLastIndex(
    (call) => FILE_CHANGING_TOOLS.has(call.toolName) && !call.isError,
  );
  const since = calls.slice(lastChange + 1);
  const earlier = calls.slice(0, lastChange + 1);
  const made: ListedCheck[] = [];
  const notMade: NotMadeCheck[] = [];
  for (const check of listed) {
    const after = outcomesOf(check, since);
    if (after.includes(expected(check))) {
      made.push(check);
    } else {
      notMade.push({ check, reason: reasonNotMade(check, after, outcomesOf(check, earlier)) });
    }
  }
  return { made, notMade };
}

export function checkLabel(check: ListedCheck): string {
  return check.kind === 'request'
    ? `${check.method.toUpperCase()} ${check.path} → ${String(check.status)}`
    : `${check.command} → exit code ${String(check.exitCode)}`;
}

/** finish's answer when it lists checks the session did not make, the first time. */
export function notMadeRefusal(notMade: readonly NotMadeCheck[]): string {
  return [
    'finish was not accepted: it lists checks this session did not make after its last change.',
    ...notMade.map(({ check, reason }) => `- ${checkLabel(check)}: ${reason}`),
    'Make them now and call finish again, or call finish again without them. Checks listed but not made are shown to the person as not made.',
  ].join('\n');
}
