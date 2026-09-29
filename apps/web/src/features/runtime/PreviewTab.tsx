/**
 * The running server's pages in a sandboxed iframe (preview-sandbox.ts says
 * what the sandbox allows and why). The label is explicit: this is project
 * code, which anyone in the project may have written.
 */
import { useId, useState } from 'react';
import { ExternalLink, RotateCw, ShieldAlert } from 'lucide-react';
import type { Server } from './run-state.js';
import { PREVIEW_SANDBOX, previewUrl } from './preview-sandbox.js';

export type PreviewTabProps = {
  /** The last server that listened, kept through a restart. */
  server: Server | null;
  restarting: boolean;
};

export function PreviewTab({ server, restarting }: PreviewTabProps): React.ReactElement {
  const [path, setPath] = useState('/');
  const [shownPath, setShownPath] = useState('/');
  const [reloads, setReloads] = useState(0);
  const inputId = useId();

  if (!server) {
    return (
      <p className="p-3 text-xs text-zinc-500">
        Run the project. The preview shows its server once it is listening.
      </p>
    );
  }

  const src = previewUrl(server.url, shownPath);

  return (
    <div className="flex h-full flex-col">
      <p className="flex items-start gap-1.5 border-b border-amber-900/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-100">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Running project code, written by anyone in this project. Don't enter passwords or personal
          details here.
        </span>
      </p>
      <form
        className="flex gap-1.5 border-b border-zinc-800 px-3 py-1.5 text-xs"
        onSubmit={(event) => {
          event.preventDefault();
          setShownPath(path);
          setReloads((count) => count + 1);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Preview path
        </label>
        <input
          id={inputId}
          value={path}
          onChange={(event) => setPath(event.target.value)}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-zinc-100"
        />
        <button
          type="submit"
          aria-label="Load"
          title="Load"
          className="rounded-md border border-zinc-700 px-1.5 text-zinc-300 hover:border-zinc-500"
        >
          <RotateCw className="size-3.5" aria-hidden />
        </button>
        {src && (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the preview in a new tab"
            title="Open in a new tab"
            className="flex items-center rounded-md border border-zinc-700 px-1.5 text-zinc-300 hover:border-zinc-500"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </form>
      <div className="relative min-h-0 flex-1 bg-white">
        {src ? (
          <iframe
            key={reloads}
            title="Preview of the running project"
            src={src}
            sandbox={PREVIEW_SANDBOX}
            referrerPolicy="no-referrer"
            className="h-full w-full border-0"
          />
        ) : (
          <p className="p-3 text-xs text-zinc-600">
            Enter a path on the running server, like /users.
          </p>
        )}
        {restarting && (
          <p className="absolute inset-x-0 top-0 bg-sky-950/90 px-3 py-1 text-xs text-sky-100">
            The server is restarting; reload when it is back.
          </p>
        )}
      </div>
    </div>
  );
}
