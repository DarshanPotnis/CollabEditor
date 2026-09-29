/**
 * Whether a replayed tool call came out the way the recording says it did.
 *
 * A replay ("Watch a demo") feeds a recorded session's model answers to
 * today's real tools. The answers cannot adapt, so a result that differs from
 * the recorded one means the rest of the recording no longer fits what is
 * happening: the replay stops there (replay-monitor.ts).
 *
 * What must match is the effect, not the words: error or success for every
 * tool, an HTTP request's status, a command's exit code, and the lines an
 * edit changed. Timings, dates and a tool's wording may differ.
 */
import { answeredStatus } from '../runtime/run-text.js';

export type CallResult = { toolName: string; isError: boolean; output: string };

/** One side of a divergence, for a person to read. */
export type ResultSummary = string;

export type Divergence = { toolName: string; recorded: ResultSummary; now: ResultSummary };

const firstLine = (output: string): string => {
  const line = output.split('\n')[0] ?? '';
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
};

/** The part of a result that must match between a recording and its replay. */
export function resultSignature({ toolName, isError, output }: CallResult): string {
  if (toolName === 'run_command') {
    const code = / exited with code (-?\d+) after /.exec(output)?.[1];
    if (code !== undefined) return `exit code ${code}`;
  }
  if (isError) return 'error';
  switch (toolName) {
    case 'http_request':
      return `status ${String(answeredStatus(output) ?? 'unknown')}`;
    case 'edit_file': {
      const lines = /\(changed (lines? [\d–-]+)\)/.exec(output)?.[1];
      return lines === undefined ? 'edited' : `edited ${lines}`;
    }
    default:
      return 'ok';
  }
}

function summary(result: CallResult): ResultSummary {
  const signature = resultSignature(result);
  return signature === 'error' ? `error: ${firstLine(result.output)}` : signature;
}

/** Null when the replayed result has the recorded one's effect; otherwise both, in words. */
export function compareResults(recorded: CallResult, now: CallResult): Divergence | null {
  if (recorded.toolName === now.toolName && resultSignature(recorded) === resultSignature(now)) {
    return null;
  }
  return { toolName: now.toolName, recorded: summary(recorded), now: summary(now) };
}
