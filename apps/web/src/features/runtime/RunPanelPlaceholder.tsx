import { Play } from 'lucide-react';

/** Phase 3 puts the WebContainer runtime, terminal and API console here. */
export function RunPanelPlaceholder(): React.ReactElement {
  return (
    <section aria-labelledby="run-heading" className="flex h-full flex-col">
      <h2
        id="run-heading"
        className="border-b border-zinc-800 px-3 py-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase"
      >
        Run
      </h2>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <Play className="size-5 text-zinc-600" aria-hidden />
        <p className="text-sm text-zinc-400">Running the project in your browser is coming soon.</p>
      </div>
    </section>
  );
}
