/**
 * One API console result. Everything from the server is rendered as text:
 * React escapes it, and nothing is ever treated as HTML.
 */
import type { ConsoleResult } from '../useRuntime.js';
import { MAX_BODY_BYTES } from './request-codec.js';
import { formatBody, formatBytes, statusTone, type StatusTone } from './response-format.js';

const TONE: Record<StatusTone, string> = {
  success: 'bg-emerald-900/60 text-emerald-200',
  redirect: 'bg-sky-900/60 text-sky-200',
  'client-error': 'bg-amber-900/60 text-amber-200',
  'server-error': 'bg-red-900/60 text-red-200',
  other: 'bg-zinc-800 text-zinc-200',
};

function Problem({ title, message }: { title: string; message: string }): React.ReactElement {
  return (
    <div role="alert" className="rounded-md border border-red-900 bg-red-950/40 p-2 text-xs">
      <p className="font-medium text-red-200">{title}</p>
      <p className="mt-1 break-words text-red-100/80">{message}</p>
    </div>
  );
}

export function ResponseView({ result }: { result: ConsoleResult }): React.ReactElement {
  switch (result.kind) {
    case 'unavailable':
      return <Problem title="No server to send to" message={result.message} />;
    case 'request-failed':
      return <Problem title="The request failed" message={result.message} />;
    case 'invalid-output':
      return <Problem title="The response could not be read" message={result.message} />;
    case 'response': {
      const { response } = result;
      const body = formatBody(response.body, response.headers);
      return (
        <div className="space-y-2 text-xs" aria-label="Response">
          <p className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 font-mono font-medium ${TONE[statusTone(response.status)]}`}
            >
              {response.status} {response.statusText}
            </span>
            <span className="text-zinc-400">
              {Math.round(response.ms)} ms · {formatBytes(response.size)}
            </span>
          </p>
          {response.truncated && (
            <p className="text-amber-200">
              Only the first {formatBytes(MAX_BODY_BYTES)} of the body is shown.
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
              Headers ({response.headers.length})
            </summary>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono">
              {response.headers.map(([name, value], index) => (
                <div key={`${name}-${String(index)}`} className="contents">
                  <dt className="text-zinc-400">{name}</dt>
                  <dd className="break-all text-zinc-200">{value}</dd>
                </div>
              ))}
            </dl>
          </details>
          {body.kind === 'empty' && <p className="text-zinc-500">No body.</p>}
          {(body.kind === 'json' || body.kind === 'text') && (
            <pre className="max-h-96 overflow-auto rounded-md bg-zinc-900 p-2 font-mono break-words whitespace-pre-wrap text-zinc-100">
              {body.text}
            </pre>
          )}
          {body.kind === 'binary' && (
            <div className="rounded-md bg-zinc-900 p-2">
              <p className="text-zinc-300">Binary response, {formatBytes(body.size)}.</p>
              <p className="mt-1 font-mono break-all text-zinc-500">{body.preview}</p>
            </div>
          )}
        </div>
      );
    }
  }
}
