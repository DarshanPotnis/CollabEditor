/**
 * How a recorded session plays differently today. A replay feeds the recorded
 * model answers to today's tools, so each tool call is the same call; where
 * its result differs from the recording, a tool changed what a real session
 * would have seen. Each fixture's test pins the list of differences it
 * expects, so a change to the tools that alters a real session makes a person
 * look (docs/evals/README.md).
 *
 * A result is compared by whether it failed and by its first line, with
 * timings masked, since those differ on every run.
 */
import type { AgentTrace } from '@collabcode/agent';

export type ReplayDifference = {
  step: number;
  tool: string;
  recorded: string;
  replayed: string;
};

/** "ok: first line" or "error: first line", with timings and dates masked. */
export function resultLine(isError: boolean, output: string): string {
  const first = (output.split('\n')[0] ?? '')
    .replace(/\bafter [\d.]+ s\b/g, 'after … s')
    .replace(/\b\d+(\.\d+)? ?ms\b/g, '… ms');
  return `${isError ? 'error' : 'ok'}: ${first}`;
}

export function replayDifferences(recorded: AgentTrace, replayed: AgentTrace): ReplayDifference[] {
  const calls = (trace: AgentTrace) =>
    trace.steps.flatMap((step) =>
      step.toolCalls.map((call) => ({
        step: step.index,
        tool: call.toolName,
        line: resultLine(call.isError, call.output),
      })),
    );
  const before = calls(recorded);
  const after = calls(replayed);
  const differences: ReplayDifference[] = [];
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    const was = before[index];
    const now = after[index];
    if (was?.line === now?.line && was?.tool === now?.tool) continue;
    differences.push({
      step: now?.step ?? was?.step ?? 0,
      tool: now?.tool ?? was?.tool ?? '',
      recorded: was?.line ?? '(not made)',
      replayed: now?.line ?? '(not made)',
    });
  }
  return differences;
}
