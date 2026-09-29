/**
 * The model of a replay: a recorded session's answers, in order, with no model
 * behind them. Each answer comes after the time the model took to give it, cut
 * to a couple of seconds so a demo keeps moving, and its words stream to the
 * panel as they did. Waits for a busy model are not replayed: nothing is busy.
 *
 * A replay should run only a recording planReplay accepted, whose every step
 * the model answered.
 */
import type { AssistantMessage } from '@collabcode/shared';
import { createScriptedModel, type ScriptEntry } from '../scripted-model.js';
import type { AgentTrace } from '../trace.js';
import type { Clock, ModelClient } from '../types.js';

/** The longest a replayed answer waits before it comes. */
export const REPLAY_THINK_MS = 2_000;

const textOf = (message: AssistantMessage): string[] =>
  message.parts.flatMap((part) => (part.type === 'text' && part.text !== '' ? [part.text] : []));

export function createReplayModel(
  trace: AgentTrace,
  clock: Clock,
  thinkMs: number = REPLAY_THINK_MS,
): ModelClient {
  const entries = trace.steps.flatMap((step): ScriptEntry[] => {
    const answer = step.model;
    if (answer === null) return [];
    return [
      async (request) => {
        await clock.sleep(Math.min(answer.durationMs, thinkMs), request.signal);
        return {
          message: answer.message,
          finishReason: answer.finishReason,
          usage: answer.usage,
          text: textOf(answer.message),
        };
      },
    ];
  });
  const first = trace.steps.find((step) => step.model !== null)?.model;
  return createScriptedModel(
    entries,
    first ? { provider: first.provider, id: first.id } : undefined,
  );
}
