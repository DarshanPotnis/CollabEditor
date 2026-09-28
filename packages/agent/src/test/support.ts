/**
 * Helpers for the agent core's tests: a ToolHost that records calls, and a way
 * to run a session to the end on a fake clock.
 */
import type { FakeClock } from '../fake-clock.js';
import { createStopSource } from '../stop-source.js';
import type { HostToolCall, StopSignal, ToolHost, ToolOutcome } from '../types.js';

export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Runs `promise` to the end. Whenever nothing else can happen, time moves to
 * the next sleep that is due, so waits and time limits play out instantly.
 */
export async function drive<T>(clock: FakeClock, promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let turn = 0; turn < 1_000; turn += 1) {
    await flush();
    if (settled) return promise;
    const next = clock.nextWakeAt();
    if (next === null) throw new Error('stuck: the run is waiting on something other than time');
    clock.advance(next - clock.now());
  }
  throw new Error('the run did not finish');
}

export type RecordingHost = ToolHost & { calls: HostToolCall[]; signals: StopSignal[] };

type Handler = (call: HostToolCall, signal: StopSignal) => ToolOutcome | Promise<ToolOutcome>;

/** Answers every call with "<tool> done", or with `handler`'s answer. */
export function recordingHost(handler?: Handler): RecordingHost {
  const calls: HostToolCall[] = [];
  const signals: StopSignal[] = [];
  return {
    calls,
    signals,
    async execute(call, signal) {
      calls.push(call);
      signals.push(signal);
      return handler ? handler(call, signal) : { ok: true, output: `${call.name} done` };
    },
  };
}

/** A tool that runs until it is stopped. */
export function untilStopped(signal: StopSignal): Promise<ToolOutcome> {
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ ok: false, output: 'Stopped.' }), {
      once: true,
    });
  });
}

export const neverStopped: StopSignal = createStopSource().signal;
