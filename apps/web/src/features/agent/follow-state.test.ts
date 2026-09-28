import { describe, expect, it } from 'vitest';
import {
  NOT_FOLLOWING,
  afterFollowedFileGone,
  followReducer,
  type FollowEvent,
} from './follow-state.js';

function play(...events: FollowEvent[]) {
  return events.reduce(followReducer, NOT_FOLLOWING);
}

describe('followReducer', () => {
  it('follows from the start of a session, into the files the agent opens', () => {
    const state = play(
      { type: 'session-started' },
      { type: 'followed-into', fileId: 'users', tabWasOpen: false },
      { type: 'file-shown', fileId: 'users' },
      { type: 'followed-into', fileId: 'index', tabWasOpen: true },
      { type: 'file-shown', fileId: 'index' },
    );
    expect(state).toMatchObject({ following: true, opened: 'index', shown: 'index' });
  });

  it('stops when the person types', () => {
    expect(play({ type: 'session-started' }, { type: 'person-typed' }).following).toBe(false);
  });

  it('stops when the person opens another file, not when follow mode does', () => {
    const following = play(
      { type: 'session-started' },
      { type: 'followed-into', fileId: 'users', tabWasOpen: false },
    );
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
    expect(
      followReducer(paused, { type: 'followed-into', fileId: 'users', tabWasOpen: false }),
    ).toBe(paused);
  });
});

describe('when the agent deletes the followed file', () => {
  /** The person is in index.js; follow mode takes them into a file the agent creates. */
  const intoScratch = (tabWasOpen: boolean) =>
    play(
      { type: 'file-shown', fileId: 'index' },
      { type: 'session-started' },
      { type: 'followed-into', fileId: 'scratch', tabWasOpen },
      { type: 'file-shown', fileId: 'scratch' },
    );
  const live =
    (...ids: string[]) =>
    (fileId: string) =>
      ids.includes(fileId);

  it('does nothing while the file is there', () => {
    expect(afterFollowedFileGone(intoScratch(false), live('index', 'scratch'))).toBeNull();
  });

  it('goes back to the file shown before, closing the tab follow mode opened', () => {
    expect(afterFollowedFileGone(intoScratch(false), live('index'))).toEqual({
      show: 'index',
      close: 'scratch',
    });
  });

  it('leaves the tab alone when the person had it open, and a previous file that is gone too', () => {
    expect(afterFollowedFileGone(intoScratch(true), live('index'))).toEqual({
      show: 'index',
      close: null,
    });
    expect(afterFollowedFileGone(intoScratch(false), live())).toEqual({
      show: null,
      close: 'scratch',
    });
  });

  it('keeps following through the switch, and into the next file', () => {
    const gone = followReducer(intoScratch(false), {
      type: 'followed-file-gone',
      showing: 'index',
    });
    const back = followReducer(gone, { type: 'file-shown', fileId: 'index' });
    expect(back).toMatchObject({ following: true, opened: 'index' });
    expect(afterFollowedFileGone(back, live('index'))).toBeNull();
    const next: FollowEvent[] = [
      { type: 'followed-into', fileId: 'users', tabWasOpen: false },
      { type: 'file-shown', fileId: 'users' },
    ];
    expect(next.reduce(followReducer, back)).toMatchObject({
      following: true,
      opened: 'users',
      previous: 'index',
    });
  });

  it('with nothing to go back to, whichever tab comes up does not stop following', () => {
    const gone = followReducer(intoScratch(false), { type: 'followed-file-gone', showing: null });
    expect(followReducer(gone, { type: 'file-shown', fileId: 'package' }).following).toBe(true);
  });

  it('does not act once the person has taken over', () => {
    const paused = followReducer(intoScratch(false), { type: 'person-typed' });
    expect(afterFollowedFileGone(paused, live('index'))).toBeNull();
  });
});
