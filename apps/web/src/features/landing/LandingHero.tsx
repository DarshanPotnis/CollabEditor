/**
 * The top of the landing page: what CollabCode is, led by the AI teammate,
 * with "Watch a demo" first and a looping recording of that replay beside it.
 * The recording is served from this site: the page is cross-origin isolated
 * (COEP require-corp), which blocks images from other origins.
 */
import { ArrowUpRight, Loader2, Play } from 'lucide-react';

/** The evals' documentation, for the proof line. No pass rate until the three-session runs. */
export const EVALS_URL = 'https://github.com/DarshanPotnis/CollabEditor/tree/main/docs/evals';

export function LandingHero({
  onWatchDemo,
  loading,
  disabled,
}: {
  onWatchDemo: () => void;
  /** The demo project is being created. */
  loading: boolean;
  disabled: boolean;
}): React.ReactElement {
  return (
    <header className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-5">
        <h1 className="text-3xl font-semibold tracking-tight">CollabCode</h1>
        <p className="text-xl text-zinc-100">Code together, with an AI teammate in the room.</p>
        <p className="text-zinc-400">
          A multiplayer code workspace in the browser. The AI joins as a collaborator: it types its
          edits live with its own cursor, runs the project&rsquo;s Node backend in your browser,
          checks every case it changed, and one click undoes its work.
        </p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={onWatchDemo}
            disabled={disabled}
            className="flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            Watch a demo
          </button>
          <p className="text-xs text-zinc-500">
            A recorded session replayed into a fresh project: the edits, the runs and the checks
            happen live in your browser, and no AI runs.
          </p>
        </div>
        <a
          href={EVALS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-violet-300 hover:text-violet-200"
        >
          Measured by a 21-task eval suite
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      </div>
      <figure className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
        <img
          src="/demo.gif"
          width={640}
          height={209}
          alt="A replay of the AI teammate: on the left the person who pressed Play, on the right a collaborator watching it type a DELETE endpoint into routes/users.js while the project runs."
          className="block h-auto w-full"
        />
        <figcaption className="px-3 py-2 text-xs text-zinc-500">
          Left: you, watching the replay. Right: a collaborator sees the AI type.
        </figcaption>
      </figure>
    </header>
  );
}
