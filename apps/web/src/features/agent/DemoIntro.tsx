/**
 * The AI panel of a demo project before the replay starts: what will play and
 * that no AI runs, and Play. Where the page cannot run the project live (it is
 * not cross-origin isolated), it offers the recording in the trace viewer
 * instead, labelled as a recording, and names the browsers a live replay needs.
 */
import type { AgentTrace } from '@collabcode/agent';
import { useEffect, useState } from 'react';
import { isolationProblem, pageIsolation } from '../runtime/runtime-support.js';
import { loadDemoRecording } from './demo-recording.js';
import { RecordingView } from './RecordingView.js';
import { replayBanner } from './replay-labels.js';

export function DemoIntro({
  onPlay,
  ready,
}: {
  onPlay: (recording: AgentTrace) => void;
  /** False until the project has loaded; a replay started sooner would be refused. */
  ready: boolean;
}): React.ReactElement {
  const [recording, setRecording] = useState<AgentTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [problem] = useState(() => isolationProblem(pageIsolation()));

  useEffect(() => {
    let current = true;
    loadDemoRecording().then(
      (loaded) => {
        if (current) setRecording(loaded);
      },
      (cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      current = false;
    };
  }, []);

  if (error !== null) {
    return (
      <p role="alert" className="text-xs text-red-200">
        {error}
      </p>
    );
  }
  if (recording === null) {
    return (
      <p role="status" className="text-xs text-zinc-400">
        Loading the demo recording…
      </p>
    );
  }
  if (problem !== null || viewing) return <RecordingView recording={recording} />;

  const model = recording.steps.find((step) => step.model !== null)?.model;
  return (
    <div className="space-y-2">
      <p
        aria-label="Replay"
        className="rounded-md border border-violet-900/60 bg-violet-950/30 p-2 text-xs text-violet-100"
      >
        {replayBanner({
          recordedAt: recording.startedAt,
          prompt:
            recording.prompt === null
              ? null
              : `${recording.prompt.id}@${String(recording.prompt.version)}`,
          model: model?.id ?? null,
        })}
      </p>
      <p className="text-xs text-zinc-400">The goal it was given:</p>
      <p className="text-xs text-zinc-200">{recording.inputs.goal}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => onPlay(recording)}
          className="rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-violet-600"
        >
          {ready ? 'Play the replay' : 'Connecting…'}
        </button>
        <button
          type="button"
          onClick={() => setViewing(true)}
          className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-zinc-500"
        >
          View the recorded session instead
        </button>
      </div>
    </div>
  );
}
