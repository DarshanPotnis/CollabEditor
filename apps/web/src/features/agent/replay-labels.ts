/**
 * The words that mark a replay as one (docs/PLAN-AI.md, AI-5): the avatar's
 * name, which anyone in the project sees, the prefix on its status, the
 * banner, and what the panel says when a replay stops matching its recording
 * or cannot run live at all. A replay is never shown as a live session, and a
 * recording's run results are never shown as happening now.
 */
import type { ReplayDivergence } from '@collabcode/agent';
import type { ReplayLabel } from './agent-session-state.js';

export const REPLAY_AGENT_NAME = 'AI teammate (replay)';
export const REPLAY_STATUS_PREFIX = 'Replay · ';

/** Where a live replay needs WebContainers, which only these browsers run in full. */
export const LIVE_REPLAY_BROWSERS = 'Chrome, Edge or Arc';

function recordedWith(label: ReplayLabel): string {
  const day = new Date(label.recordedAt).toISOString().slice(0, 10);
  const what = [label.prompt, label.model].filter((part): part is string => part !== null);
  return `recorded ${day}${what.length > 0 ? ` with ${what.join(' on ')}` : ''}`;
}

export function replayBanner(label: ReplayLabel): string {
  return `Replay of a recorded session (${recordedWith(label)}). No AI is running: the model’s answers are the recording’s, and the edits, runs and checks are happening now.`;
}

/** A sentence's end, unless the text already has one. */
const ended = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

export function divergenceText(divergence: ReplayDivergence): string {
  return `The replay stopped at step ${String(divergence.step)}: today’s code answered ${divergence.toolName} differently from the recording, so the rest of it no longer fits. Recorded: ${ended(divergence.recorded)} Now: ${ended(divergence.now)}`;
}

export function recordingNote(): string {
  return `This is the recording of a past session, shown as a timeline: nothing in it is happening now. The live replay needs a browser that can run the project in the page (${LIVE_REPLAY_BROWSERS}).`;
}
