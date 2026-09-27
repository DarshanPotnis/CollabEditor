import { useEffect, useState } from 'react';

/**
 * True once something has been pending for longer than people expect, which is
 * when a wait deserves an explanation rather than a spinner.
 */
export function useSlowFlag(pending: boolean, afterMs: number): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), afterMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pending, afterMs]);

  return slow;
}
