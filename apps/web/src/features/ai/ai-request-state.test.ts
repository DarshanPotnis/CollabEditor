import { describe, expect, it } from 'vitest';
import type { AiFinish, AiStep } from './ai-client.js';
import {
  IDLE_AI_REQUEST,
  aiRequestReducer,
  isInFlight,
  type AiRequestEvent,
  type AiRequestState,
} from './ai-request-state.js';

const STEP: AiStep = {
  projectId: 'abc123',
  promptId: 'edit-selection',
  inputs: {
    path: 'index.js',
    language: 'javascript',
    startLine: 3,
    selection: 'let x = 1;',
    instruction: 'Use const.',
  },
};

const FINISH: AiFinish = {
  type: 'finish',
  finishReason: 'stop',
  usage: { inputTokens: 10, outputTokens: 4 },
  prompt: { id: 'edit-selection', version: 1 },
  model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
  remainingToday: 12,
};

function run(events: AiRequestEvent[], from: AiRequestState = IDLE_AI_REQUEST): AiRequestState {
  return events.reduce(aiRequestReducer, from);
}

describe('aiRequestReducer', () => {
  it('streams text into a finished answer', () => {
    const state = run([
      { type: 'send', id: 1, step: STEP },
      { type: 'text', id: 1, text: '```js\n' },
      { type: 'text', id: 1, text: 'const x = 1;\n```' },
      { type: 'finish', id: 1, finish: FINISH },
    ]);
    expect(state).toEqual({
      phase: 'done',
      id: 1,
      step: STEP,
      text: '```js\nconst x = 1;\n```',
      finish: FINISH,
    });
  });

  it('finishes with empty text when the model says nothing', () => {
    const state = run([
      { type: 'send', id: 1, step: STEP },
      { type: 'finish', id: 1, finish: FINISH },
    ]);
    expect(state).toMatchObject({ phase: 'done', text: '' });
  });

  it('keeps the text that arrived before a failure', () => {
    const failure = { code: 'unavailable', message: 'The AI provider is not answering.' } as const;
    const state = run([
      { type: 'send', id: 1, step: STEP },
      { type: 'text', id: 1, text: 'partial' },
      { type: 'fail', id: 1, failure },
    ]);
    expect(state).toEqual({ phase: 'failed', id: 1, step: STEP, text: 'partial', failure });
  });

  it('fails before any text, with the step kept for a retry', () => {
    const failure = { code: 'quota-exhausted', message: 'Used up.' } as const;
    const state = run([
      { type: 'send', id: 1, step: STEP },
      { type: 'fail', id: 1, failure },
    ]);
    expect(state).toEqual({ phase: 'failed', id: 1, step: STEP, text: '', failure });
  });

  it('stops with the text so far, then ignores the stopped request', () => {
    const state = run([
      { type: 'send', id: 1, step: STEP },
      { type: 'text', id: 1, text: 'so far' },
      { type: 'stop' },
      { type: 'text', id: 1, text: ' and late' },
      { type: 'finish', id: 1, finish: FINISH },
    ]);
    expect(state).toEqual({ phase: 'stopped', id: 1, step: STEP, text: 'so far' });
  });

  it('ignores a stop when nothing is in flight', () => {
    const done = run([
      { type: 'send', id: 1, step: STEP },
      { type: 'finish', id: 1, finish: FINISH },
    ]);
    expect(aiRequestReducer(done, { type: 'stop' })).toBe(done);
    expect(aiRequestReducer(IDLE_AI_REQUEST, { type: 'stop' })).toBe(IDLE_AI_REQUEST);
  });

  it('drops late events from a request that was replaced', () => {
    const state = run([
      { type: 'send', id: 1, step: STEP },
      { type: 'text', id: 1, text: 'old' },
      { type: 'send', id: 2, step: STEP },
      { type: 'text', id: 1, text: ' stale' },
      { type: 'fail', id: 1, failure: { code: 'network', message: 'gone' } },
      { type: 'text', id: 2, text: 'new' },
    ]);
    expect(state).toEqual({ phase: 'streaming', id: 2, step: STEP, text: 'new' });
  });

  it('ignores events once the answer is done', () => {
    const done = run([
      { type: 'send', id: 1, step: STEP },
      { type: 'finish', id: 1, finish: FINISH },
    ]);
    expect(aiRequestReducer(done, { type: 'text', id: 1, text: 'extra' })).toBe(done);
  });

  it('holds the step while the privacy notice is shown, and dismissing clears it', () => {
    const asking = run([{ type: 'ask-consent', step: STEP }]);
    expect(asking).toEqual({ phase: 'needs-consent', step: STEP });
    expect(isInFlight(asking)).toBe(false);
    expect(aiRequestReducer(asking, { type: 'dismiss' })).toEqual(IDLE_AI_REQUEST);
  });

  it('reports which phases have a request in flight', () => {
    const waiting = run([{ type: 'send', id: 1, step: STEP }]);
    const streaming = aiRequestReducer(waiting, { type: 'text', id: 1, text: 'a' });
    expect([waiting, streaming].map(isInFlight)).toEqual([true, true]);
    expect(isInFlight(aiRequestReducer(streaming, { type: 'stop' }))).toBe(false);
  });
});
