/**
 * Injects the per-collaborator cursor CSS. The rules are rebuilt only when the
 * generated text actually changes, so ordinary cursor movement (which fires an
 * awareness event on every keystroke) does not touch the DOM.
 */
import { useEffect, useMemo } from 'react';
import { remoteCursorStyles, type RemoteCursor } from './remote-cursor-styles.js';

export function useRemoteCursorStyles(cursors: readonly RemoteCursor[]): void {
  const css = useMemo(() => remoteCursorStyles(cursors), [cursors]);

  useEffect(() => {
    if (css === '') return;
    const style = document.createElement('style');
    style.dataset['collabcode'] = 'remote-cursors';
    style.textContent = css;
    document.head.append(style);
    return () => {
      style.remove();
    };
  }, [css]);
}
