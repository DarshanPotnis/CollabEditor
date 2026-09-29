/**
 * The agent core stops things with its own StopSignal; browser APIs (fetch,
 * the runner) take an AbortSignal. This bridges one to the other.
 */
import type { StopSignal } from '@collabcode/agent';

export function abortSignalFor(stop: StopSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  stop.addEventListener('abort', abort, { once: true });
  if (stop.aborted) abort();
  return { signal: controller.signal, dispose: () => stop.removeEventListener('abort', abort) };
}
