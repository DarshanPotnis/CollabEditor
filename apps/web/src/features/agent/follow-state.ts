/**
 * Following the AI teammate: while its session runs, the person who started
 * it sees the file it works in, scrolled to its caret. Following stops the
 * moment they take over (they type, or open another file themselves) and
 * resumes with "Follow AI". Opening the agent's file is follow mode's own
 * doing, so that never counts as them switching away.
 */

export type FollowState = {
  following: boolean;
  /** The file follow mode last opened, which is not the person switching. */
  opened: string | null;
};

export type FollowEvent =
  | { type: 'session-started' }
  | { type: 'resumed' }
  | { type: 'person-typed' }
  /** The file the person has shown changed, for whatever reason. */
  | { type: 'file-shown'; fileId: string | null }
  | { type: 'followed-into'; fileId: string }
  | { type: 'session-ended' };

export const NOT_FOLLOWING: FollowState = { following: false, opened: null };

export function followReducer(state: FollowState, event: FollowEvent): FollowState {
  switch (event.type) {
    case 'session-started':
    case 'resumed':
      return { following: true, opened: null };
    case 'followed-into':
      return state.following ? { ...state, opened: event.fileId } : state;
    case 'file-shown':
      if (!state.following || event.fileId === state.opened || state.opened === null) return state;
      return NOT_FOLLOWING;
    case 'person-typed':
    case 'session-ended':
      return state.following ? NOT_FOLLOWING : state;
  }
}
