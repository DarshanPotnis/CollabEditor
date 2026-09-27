import { describe, expect, it } from 'vitest';
import {
  CLOSE_MESSAGE_TOO_BIG,
  INITIAL_CONNECTION_STATE,
  describeConnection,
  nextConnectionState,
  type ConnectionEvent,
  type ConnectionState,
} from './connection-state.js';

function run(events: ConnectionEvent[], from = INITIAL_CONNECTION_STATE): ConnectionState {
  return events.reduce(nextConnectionState, from);
}

describe('nextConnectionState', () => {
  it('starts out connecting', () => {
    expect(INITIAL_CONNECTION_STATE).toEqual({ kind: 'connecting' });
  });

  it('explains a slow first connection as a cold start', () => {
    expect(run([{ type: 'slow-start' }])).toEqual({ kind: 'waking' });
  });

  it('does not call a later stall a cold start', () => {
    expect(run([{ type: 'synced' }, { type: 'disconnected' }, { type: 'slow-start' }])).toEqual({
      kind: 'reconnecting',
    });
  });

  it('goes to synced from any non-final state', () => {
    for (const events of [
      [{ type: 'slow-start' }],
      [{ type: 'disconnected' }],
      [{ type: 'browser-offline' }],
      [{ type: 'disconnected', code: CLOSE_MESSAGE_TOO_BIG }],
    ] satisfies ConnectionEvent[][]) {
      expect(run([...events, { type: 'synced' }])).toEqual({ kind: 'synced' });
    }
  });

  it('calls a drop after syncing a reconnect', () => {
    expect(run([{ type: 'synced' }, { type: 'disconnected' }])).toEqual({ kind: 'reconnecting' });
  });

  it('keeps waiting rather than claiming a reconnect before the first sync', () => {
    expect(run([{ type: 'disconnected' }])).toEqual({ kind: 'connecting' });
    expect(run([{ type: 'slow-start' }, { type: 'disconnected' }])).toEqual({ kind: 'waking' });
  });

  it('tracks the browser going offline and back', () => {
    const offline = run([{ type: 'synced' }, { type: 'browser-offline' }]);
    expect(offline).toEqual({ kind: 'offline' });
    expect(nextConnectionState(offline, { type: 'disconnected' })).toEqual({ kind: 'offline' });
    expect(nextConnectionState(offline, { type: 'browser-online' })).toEqual({
      kind: 'reconnecting',
    });
  });

  it('recognises the too-big close code', () => {
    expect(
      run([{ type: 'synced' }, { type: 'disconnected', code: CLOSE_MESSAGE_TOO_BIG }]),
    ).toEqual({ kind: 'payload-too-large' });
  });

  it('treats a refusal as final', () => {
    const refused = run([{ type: 'refused', reason: 'project-not-found' }]);
    expect(refused).toEqual({ kind: 'refused', reason: 'project-not-found' });
    for (const event of [
      { type: 'synced' },
      { type: 'disconnected' },
      { type: 'browser-online' },
    ] satisfies ConnectionEvent[]) {
      expect(nextConnectionState(refused, event)).toBe(refused);
    }
  });
});

describe('describeConnection', () => {
  it('says nothing when synced', () => {
    expect(describeConnection({ kind: 'synced' })).toBeNull();
  });

  it('sets expectations for a cold start', () => {
    const message = describeConnection({ kind: 'waking' });
    expect(message?.title).toMatch(/waking up/i);
    expect(message?.detail).toContain('can take up to a minute');
  });

  it('reassures rather than alarms when the connection drops', () => {
    expect(describeConnection({ kind: 'reconnecting' })?.detail).toMatch(/merge/i);
    expect(describeConnection({ kind: 'offline' })?.detail).toMatch(/kept/i);
  });

  it('explains the too-big close in terms of what to do next', () => {
    const message = describeConnection({ kind: 'payload-too-large' });
    expect(message?.tone).toBe('error');
    expect(message?.detail).toMatch(/undo/i);
  });

  it('turns a known refusal reason into plain language', () => {
    expect(describeConnection({ kind: 'refused', reason: 'project-not-found' })?.detail).toBe(
      'This project no longer exists.',
    );
    expect(describeConnection({ kind: 'refused', reason: 'invalid-project-id' })?.detail).toContain(
      'invalid-project-id',
    );
  });
});
