import { describe, expect, it } from 'vitest';
import { NOT_FOLLOWING, followReducer, type FollowEvent } from './follow-state.js';

function play(...events: FollowEvent[]) {
  return events.reduce(followReducer, NOT_FOLLOWING);
}

describe('followReducer', () => {
  it('follows from the start of a session, into the files the agent opens', () => {
    const state = play(
      { type: 'session-started' },
      { type: 'followed-into', fileId: 'users' },
      { type: 'file-shown', fileId: 'users' },
      { type: 'followed-into', fileId: 'index' },
      { type: 'file-shown', fileId: 'index' },
    );
    expect(state).toEqual({ following: true, opened: 'index' });
  });

  it('stops when the person types', () => {
    expect(play({ type: 'session-started' }, { type: 'person-typed' }).following).toBe(false);
  });

  it('stops when the person opens another file, not when follow mode does', () => {
    const following = play({ type: 'session-started' }, { type: 'followed-into', fileId: 'users' });
    expect(followReducer(following, { type: 'file-shown', fileId: 'users' }).following).toBe(true);
    expect(followReducer(following, { type: 'file-shown', fileId: 'package' }).following).toBe(
      false,
    );
  });

  it('ignores the file already shown when the session starts', () => {
    expect(
      play({ type: 'session-started' }, { type: 'file-shown', fileId: 'index' }).following,
    ).toBe(true);
  });

  it('resumes with Follow AI, and stops when the session ends', () => {
    const paused = play({ type: 'session-started' }, { type: 'person-typed' });
    expect(followReducer(paused, { type: 'resumed' }).following).toBe(true);
    expect(
      followReducer(followReducer(paused, { type: 'resumed' }), { type: 'session-ended' }),
    ).toEqual(NOT_FOLLOWING);
  });

  it('does not follow into a file once paused', () => {
    const paused = play({ type: 'session-started' }, { type: 'person-typed' });
    expect(followReducer(paused, { type: 'followed-into', fileId: 'users' })).toBe(paused);
  });
});
