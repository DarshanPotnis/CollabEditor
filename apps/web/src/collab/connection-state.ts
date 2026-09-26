/**
 * The connection state machine, kept pure so the awkward parts (a cold start
 * that looks like a hang, a refusal, a reconnect) can be tested without a
 * server.
 *
 * Yjs merges on reconnect, so "offline" is reassuring rather than alarming:
 * edits made while disconnected are kept and sent when the socket returns.
 */
import { MAX_TRANSPORT_PAYLOAD } from '@collabcode/shared';

/** WebSocket close code for a frame larger than the server accepts. */
export const CLOSE_MESSAGE_TOO_BIG = 1009;

/** How long a first connection may take before we blame a cold start. */
export const WAKING_AFTER_MS = 2_000;

export type ConnectionState =
  | { kind: 'connecting' }
  | { kind: 'waking' }
  | { kind: 'synced' }
  | { kind: 'reconnecting' }
  | { kind: 'offline' }
  | { kind: 'refused'; reason: string }
  | { kind: 'payload-too-large' };

export type ConnectionEvent =
  | { type: 'synced' }
  | { type: 'disconnected'; code?: number }
  | { type: 'slow-start' }
  | { type: 'refused'; reason: string }
  | { type: 'browser-offline' }
  | { type: 'browser-online' };

export const INITIAL_CONNECTION_STATE: ConnectionState = { kind: 'connecting' };

/** A refusal is final: the server will not serve this document to us. */
function isFinal(state: ConnectionState): boolean {
  return state.kind === 'refused';
}

export function nextConnectionState(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  if (isFinal(state)) return state;

  switch (event.type) {
    case 'refused':
      return { kind: 'refused', reason: event.reason };

    case 'synced':
      return { kind: 'synced' };

    case 'slow-start':
      // Only the *first* connection gets the cold-start explanation; a later
      // drop is a reconnect, which says something different.
      return state.kind === 'connecting' ? { kind: 'waking' } : state;

    case 'browser-offline':
      return { kind: 'offline' };

    case 'browser-online':
      return state.kind === 'offline' ? { kind: 'reconnecting' } : state;

    case 'disconnected': {
      if (event.code === CLOSE_MESSAGE_TOO_BIG) return { kind: 'payload-too-large' };
      if (state.kind === 'offline') return state;
      // Still waiting for the first connection: keep explaining the wait
      // rather than claiming we lost something we never had.
      if (state.kind === 'connecting' || state.kind === 'waking') return state;
      return { kind: 'reconnecting' };
    }
  }
}

export type ConnectionMessage = {
  tone: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
};

/** What to tell the user, or null when everything is fine and quiet. */
export function describeConnection(state: ConnectionState): ConnectionMessage | null {
  switch (state.kind) {
    case 'synced':
      return null;

    case 'connecting':
      return { tone: 'info', title: 'Connecting…', detail: 'Opening the live connection.' };

    case 'waking':
      return {
        tone: 'info',
        title: 'Waking up the server…',
        detail:
          'The free server sleeps when nobody is using it, so the first connection can take up to a minute. Your editor will fill in as soon as it answers.',
      };

    case 'reconnecting':
      return {
        tone: 'warning',
        title: 'Reconnecting…',
        detail: 'Keep typing — your edits are saved locally and will merge when you are back.',
      };

    case 'offline':
      return {
        tone: 'warning',
        title: 'Offline',
        detail: 'Your edits are kept and will sync when you are back online.',
      };

    case 'payload-too-large':
      return {
        tone: 'error',
        title: 'That change was too big to send',
        detail: `The server refuses single updates over ${Math.round(MAX_TRANSPORT_PAYLOAD / (1024 * 1024))} MB. Undo the last paste, then reload the page.`,
      };

    case 'refused':
      return {
        tone: 'error',
        title: 'The server refused this project',
        detail:
          state.reason === 'project-not-found'
            ? 'This project no longer exists.'
            : `The connection was refused (${state.reason}).`,
      };
  }
}
