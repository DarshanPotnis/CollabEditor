import { useEffect, useRef } from 'react';
import type { ResolvedTree } from '@collabcode/shared';
import type { ToastStore } from '../features/notifications/toast-store.js';
import { cycleMessage, newCycles } from './cycle-notice.js';

/** Toast an explanation whenever a concurrent cross-move produces a cycle. */
export function useCycleNotice(tree: ResolvedTree, toasts: ToastStore): void {
  const previous = useRef(tree);
  useEffect(() => {
    for (const cycle of newCycles(previous.current, tree)) {
      toasts.show({ message: cycleMessage(tree, cycle), tone: 'info', durationMs: 10_000 });
    }
    previous.current = tree;
  }, [tree, toasts]);
}
