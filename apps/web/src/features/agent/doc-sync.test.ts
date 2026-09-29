import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { DOC_SYNC_TIMEOUT_MS, hasEditsOf, waitForEditsOf } from './doc-sync.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function pair() {
  const person = new Y.Doc();
  const agent = new Y.Doc();
  Y.applyUpdate(agent, Y.encodeStateAsUpdate(person));
  const deliver = (): void =>
    Y.applyUpdate(person, Y.encodeStateAsUpdate(agent, Y.encodeStateVector(person)));
  return { person, agent, deliver };
}

describe('hasEditsOf', () => {
  it('is true when the agent has written nothing, and once its edits arrive', () => {
    const { person, agent, deliver } = pair();
    expect(hasEditsOf(agent, person)).toBe(true);
    agent.getText('t').insert(0, 'edit');
    expect(hasEditsOf(agent, person)).toBe(false);
    deliver();
    expect(hasEditsOf(agent, person)).toBe(true);
  });

  it('ignores edits by others that the agent has and the person does not', () => {
    const { person, agent } = pair();
    const other = new Y.Doc();
    other.getText('t').insert(0, 'theirs');
    Y.applyUpdate(agent, Y.encodeStateAsUpdate(other));
    expect(hasEditsOf(agent, person)).toBe(true);
  });
});

describe('waitForEditsOf', () => {
  it('resolves when the edits arrive', async () => {
    const { person, agent, deliver } = pair();
    agent.getText('t').insert(0, 'edit');
    const waiting = waitForEditsOf(agent, person, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(300);
    deliver();
    expect(await waiting).toBe(true);
  });

  it('gives up after the timeout instead of waiting for ever', async () => {
    const { person, agent } = pair();
    agent.getText('t').insert(0, 'edit');
    const waiting = waitForEditsOf(agent, person, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(DOC_SYNC_TIMEOUT_MS);
    expect(await waiting).toBe(false);
  });

  it('stops waiting when stopped', async () => {
    const { person, agent } = pair();
    agent.getText('t').insert(0, 'edit');
    const controller = new AbortController();
    const waiting = waitForEditsOf(agent, person, controller.signal);
    controller.abort();
    expect(await waiting).toBe(false);
  });
});
