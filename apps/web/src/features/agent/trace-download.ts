/**
 * "Download trace": the session's trace as a JSON file, to keep a good run as
 * the recording for the replay demo or as a regression example for the evals.
 * It holds the project code and output the agent saw, and never a key.
 */
import type { AgentTrace } from '@collabcode/agent';

export function traceFileName(trace: AgentTrace): string {
  const day = new Date(trace.startedAt).toISOString().slice(0, 10);
  return `collabcode-agent-trace-${day}-${trace.sessionId}.json`;
}

export function downloadTrace(trace: AgentTrace): void {
  const blob = new Blob([`${JSON.stringify(trace, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = traceFileName(trace);
  link.click();
  URL.revokeObjectURL(url);
}
