/**
 * A recording shown as a timeline, labelled as one: what the replay would
 * have played, for a browser that cannot run it live, or to compare with a
 * replay that stopped. Nothing in it is shown as happening now.
 */
import type { AgentTrace } from '@collabcode/agent';
import { useMemo } from 'react';
import { recordingNote } from './replay-labels.js';
import { traceTimeline } from './trace-timeline.js';
import { TraceTimeline } from './TraceTimeline.js';

export function RecordingView({ recording }: { recording: AgentTrace }): React.ReactElement {
  const timeline = useMemo(() => traceTimeline(recording), [recording]);
  return (
    <section aria-label="Recorded session" className="space-y-2">
      <p className="rounded-md border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-300">
        <span className="font-semibold">Recorded session.</span> {recordingNote()}
      </p>
      <TraceTimeline timeline={timeline} />
    </section>
  );
}
