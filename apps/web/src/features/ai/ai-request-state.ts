/**
 * One AI request as the panel shows it, as a pure reducer.
 *
 *   idle ─start─► waiting ─text─► streaming ─finish─► done
 *     │              ▲
 *     │              └──────────── accept ─────────────┐
 *     └─start, privacy notice not yet accepted─► needs-consent
 *
 *   waiting or streaming ─fail─► failed
 *   waiting or streaming ─stop─► stopped
 *
 * A new request can start from any phase and replaces the current one. Each
 * request gets a new id and its events carry it, so a late event from a
 * request that was replaced or stopped is dropped instead of mixing into the
 * current one. Text received before a failure or a stop is kept, so the
 * person still sees what arrived.
 */
import type { ApiFailureCode } from '../../lib/api-error.js';
import type { AiFinish, AiStep } from './ai-client.js';

export type AiFailure = { code: ApiFailureCode; message: string };

export type AiRequestState =
  | { phase: 'idle' }
  | { phase: 'needs-consent'; step: AiStep }
  | { phase: 'waiting'; id: number; step: AiStep }
  | { phase: 'streaming'; id: number; step: AiStep; text: string }
  | { phase: 'done'; id: number; step: AiStep; text: string; finish: AiFinish }
  | { phase: 'failed'; id: number; step: AiStep; text: string; failure: AiFailure }
  | { phase: 'stopped'; id: number; step: AiStep; text: string };

export type AiRequestEvent =
  | { type: 'ask-consent'; step: AiStep }
  | { type: 'send'; id: number; step: AiStep }
  | { type: 'text'; id: number; text: string }
  | { type: 'finish'; id: number; finish: AiFinish }
  | { type: 'fail'; id: number; failure: AiFailure }
  | { type: 'stop' }
  | { type: 'dismiss' };

export const IDLE_AI_REQUEST: AiRequestState = { phase: 'idle' };

type InFlight = Extract<AiRequestState, { phase: 'waiting' | 'streaming' }>;

export function isInFlight(state: AiRequestState): state is InFlight {
  return state.phase === 'waiting' || state.phase === 'streaming';
}

function textSoFar(state: InFlight): string {
  return state.phase === 'streaming' ? state.text : '';
}

export function aiRequestReducer(state: AiRequestState, event: AiRequestEvent): AiRequestState {
  switch (event.type) {
    case 'ask-consent':
      return { phase: 'needs-consent', step: event.step };
    case 'send':
      return { phase: 'waiting', id: event.id, step: event.step };
    case 'dismiss':
      return IDLE_AI_REQUEST;
    case 'stop':
      return isInFlight(state)
        ? { phase: 'stopped', id: state.id, step: state.step, text: textSoFar(state) }
        : state;
  }
  if (!isInFlight(state) || state.id !== event.id) return state;
  switch (event.type) {
    case 'text':
      return {
        phase: 'streaming',
        id: state.id,
        step: state.step,
        text: textSoFar(state) + event.text,
      };
    case 'finish':
      return {
        phase: 'done',
        id: state.id,
        step: state.step,
        text: textSoFar(state),
        finish: event.finish,
      };
    case 'fail':
      return {
        phase: 'failed',
        id: state.id,
        step: state.step,
        text: textSoFar(state),
        failure: event.failure,
      };
  }
}
