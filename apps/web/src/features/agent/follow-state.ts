/**
 * Following the AI teammate: while its session runs, the person who started
 * it sees the file it works in, scrolled to its caret. Following stops the
 * moment they take over (they type, or open another file themselves) and
 * resumes with "Follow AI". Opening the agent's file is follow mode's own
 * doing, so that never counts as them switching away.
 *
 * When the agent deletes the file being followed, follow mode goes back to
 * the file shown before it (if that still exists), closes the tab if it had
 * opened it itself, and keeps following into the agent's next file, instead of
 * leaving the person in a deleted file.
 */

export type FollowState = {
  following: boolean;
  /** The file follow mode last opened, which is not the person switching. */
  opened: string | null;
  /** The file shown before follow mode opened `opened`: where to go back to if it is deleted. */
  previous: string | null;
  /** Follow mode opened the tab for `opened`; the person did not have it open. */
  openedTab: boolean;
  /** The file shown now, as last reported. */
  shown: string | null;
};

export type FollowEvent =
  | { type: 'session-started' }
  | { type: 'resumed' }
  | { type: 'person-typed' }
  /** The file the person has shown changed, for whatever reason. */
  | { type: 'file-shown'; fileId: string | null }
  | { type: 'followed-into'; fileId: string; tabWasOpen: boolean }
  /** The followed file was deleted; follow mode is showing this one instead, or none. */
  | { type: 'followed-file-gone'; showing: string | null }
  | { type: 'session-ended' };

export const NOT_FOLLOWING: FollowState = {
  following: false,
  opened: null,
  previous: null,
  openedTab: false,
  shown: null,
};

const stopped = (state: FollowState): FollowState => ({ ...NOT_FOLLOWING, shown: state.shown });

export function followReducer(state: FollowState, event: FollowEvent): FollowState {
  switch (event.type) {
    case 'session-started':
    case 'resumed':
      return { ...NOT_FOLLOWING, following: true, shown: state.shown };
    case 'followed-into':
      if (!state.following || event.fileId === state.opened) return state;
      return {
        ...state,
        opened: event.fileId,
        previous: state.shown === event.fileId ? state.previous : state.shown,
        openedTab: !event.tabWasOpen,
      };
    case 'file-shown': {
      if (event.fileId === state.shown) return state;
      const next = { ...state, shown: event.fileId };
      if (!state.following || event.fileId === state.opened || state.opened === null) return next;
      return stopped(next);
    }
    case 'followed-file-gone':
      // What follow mode shows next is its own doing too; with nothing to show, any tab is.
      return state.following
        ? { ...state, opened: event.showing, previous: null, openedTab: false }
        : state;
    case 'person-typed':
    case 'session-ended':
      return state.following ? stopped(state) : state;
  }
}

export type AfterDelete = {
  /** The file to show instead, or null to leave the tabs to decide. */
  show: string | null;
  /** The deleted file's tab, when follow mode opened it. */
  close: string | null;
};

/** What to do once the followed file has been deleted, or null when it has not. */
export function afterFollowedFileGone(
  state: FollowState,
  isLive: (fileId: string) => boolean,
): AfterDelete | null {
  if (!state.following || state.opened === null || isLive(state.opened)) return null;
  return {
    show: state.previous !== null && isLive(state.previous) ? state.previous : null,
    close: state.openedTab ? state.opened : null,
  };
}
