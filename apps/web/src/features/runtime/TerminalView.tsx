/**
 * An xterm.js terminal showing an output buffer, optionally with keyboard
 * input (the shell). Loaded lazily with the rest of the runtime.
 *
 * Program output is untrusted: xterm renders escape sequences itself and
 * never turns them into HTML, and no link addon is loaded, so nothing in the
 * output becomes clickable.
 */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { OutputBuffer } from './output-buffer.js';

export type TerminalViewProps = {
  label: string;
  source: OutputBuffer;
  onInput?: (data: string) => void;
  onResize?: (size: { cols: number; rows: number }) => void;
};

const SCROLLBACK_LINES = 5_000;

export default function TerminalView({
  label,
  source,
  onInput,
  onResize,
}: TerminalViewProps): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const terminal = new Terminal({
      scrollback: SCROLLBACK_LINES,
      disableStdin: !onInput,
      cursorBlink: Boolean(onInput),
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: { background: '#09090b', foreground: '#e4e4e7' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);

    const refit = (): void => {
      // A hidden tab has no size; fitting it would shrink the terminal to nothing.
      if (element.clientWidth > 0 && element.clientHeight > 0) fit.fit();
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(element);

    const detach = source.attach({ write: (text) => terminal.write(text) });
    const input = onInput ? terminal.onData(onInput) : null;
    const resize = onResize ? terminal.onResize(onResize) : null;
    if (onResize) onResize({ cols: terminal.cols, rows: terminal.rows });

    return () => {
      observer.disconnect();
      detach();
      input?.dispose();
      resize?.dispose();
      terminal.dispose();
    };
  }, [source, onInput, onResize]);

  return <div ref={host} role="region" aria-label={label} className="h-full w-full px-2 py-1" />;
}
