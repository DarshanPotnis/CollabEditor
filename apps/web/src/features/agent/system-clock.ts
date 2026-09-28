/** The agent core's Clock, on the browser's own timers. */
import type { Clock } from '@collabcode/agent';

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      const wake = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      signal.addEventListener('abort', wake, { once: true });
      if (signal.aborted) wake();
    }),
};
