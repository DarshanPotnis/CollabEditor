/**
 * "Open a trace…": any downloaded trace, of any format, shown as a timeline in
 * the AI panel. Opening one runs nothing and asks no model; the file is read
 * as untrusted input (trace-file.ts).
 */
import { useMemo, useRef, useState } from 'react';
import { readTraceFile, type TraceFile } from './trace-file.js';
import { traceTimeline } from './trace-timeline.js';
import { TraceTimeline } from './TraceTimeline.js';

export function TraceFileViewer(): React.ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState<{ name: string; file: TraceFile } | null>(null);
  const timeline = useMemo(
    () => (opened?.file.ok ? traceTimeline(opened.file.trace) : null),
    [opened],
  );

  const open = (file: File): void => {
    readTraceFile(file).then(
      (read) => setOpened({ name: file.name, file: read }),
      (error: unknown) =>
        setOpened({
          name: file.name,
          file: {
            ok: false,
            message: `The file could not be read: ${error instanceof Error ? error.message : String(error)}`,
          },
        }),
    );
  };

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="Trace file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) open(file);
          event.target.value = '';
        }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-zinc-500"
        >
          Open a trace…
        </button>
        {opened && (
          <button
            type="button"
            onClick={() => setOpened(null)}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-zinc-500"
          >
            Close the trace
          </button>
        )}
      </div>
      {opened && !opened.file.ok && (
        <p role="alert" className="text-xs text-red-200">
          {opened.file.message}
        </p>
      )}
      {opened?.file.ok && timeline && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            {opened.name}: a recorded session, trace format {opened.file.format}. Nothing is
            running.
          </p>
          <TraceTimeline timeline={timeline} />
        </div>
      )}
    </div>
  );
}
