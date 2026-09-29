/**
 * Watches a replay's events and finds where it stops matching its recording.
 *
 * Every tool call the loop finishes is found in the recording, by its step and
 * its call id (a replay's calls are the recorded answers', ids and all), and
 * compared with what was recorded (replay-divergence.ts). So are the calls the
 * loop answers itself, such as a refused finish. A replay that ends other than
 * the recording did (it did not finish, or finished early) diverges too. The
 * caller stops the session at the first divergence and says why.
 */
import type { AgentEvent } from '../events.js';
import type { AgentTrace, TraceToolCall } from '../trace.js';
import { compareResults } from './replay-divergence.js';

export type ReplayDivergence = {
  step: number;
  toolName: string;
  /** What the recording says happened, and what happened now, in words. */
  recorded: string;
  now: string;
};

export type ReplayMonitor = {
  /** The divergence this event shows, the first time there is one; null otherwise. */
  observe: (event: AgentEvent) => ReplayDivergence | null;
  divergence: () => ReplayDivergence | null;
};

export function createReplayMonitor(trace: AgentTrace): ReplayMonitor {
  const recorded = new Map<string, TraceToolCall>();
  for (const step of trace.steps) {
    for (const call of step.toolCalls)
      recorded.set(`${String(step.index)} ${call.toolCallId}`, call);
  }
  let first: ReplayDivergence | null = null;

  const check = (event: AgentEvent): ReplayDivergence | null => {
    if (event.type === 'tool-finished') {
      const call = recorded.get(`${String(event.step)} ${event.toolCallId}`);
      if (!call) {
        return {
          step: event.step,
          toolName: event.toolName,
          recorded: 'no such call',
          now: event.isError ? 'error' : 'ok',
        };
      }
      const differs = compareResults(call, event);
      return differs && { step: event.step, ...differs };
    }
    if (event.type === 'finished') {
      const was = trace.outcome?.kind ?? 'no ending';
      if (event.outcome.kind === was && event.totals.steps === trace.steps.length) return null;
      return {
        step: event.totals.steps,
        toolName: 'finish',
        recorded: `${was} after ${String(trace.steps.length)} steps`,
        now: `${event.outcome.kind} after ${String(event.totals.steps)} steps`,
      };
    }
    return null;
  };

  return {
    observe(event) {
      if (first !== null) return null;
      first = check(event);
      return first;
    },
    divergence: () => first,
  };
}
