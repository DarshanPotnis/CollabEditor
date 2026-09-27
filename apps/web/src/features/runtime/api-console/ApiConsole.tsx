/**
 * Call the running server's endpoints (PLAN.md §10.2). Requests are made
 * inside the container, so CORS never applies, and history is this person's
 * alone, kept in memory for the session.
 */
import { useId, useState } from 'react';
import type { ConsoleResult } from '../useRuntime.js';
import { HTTP_METHODS, type ApiRequest, type HttpMethod } from './request-codec.js';
import { buildRequest, type RequestForm } from './request-form.js';
import { ResponseView } from './ResponseView.js';

type HistoryEntry = { id: number; form: RequestForm; result: ConsoleResult };

const MAX_HISTORY = 20;
const INITIAL: RequestForm = { method: 'GET', path: '/users', headersText: '', body: '' };

function summary(result: ConsoleResult): string {
  switch (result.kind) {
    case 'response':
      return `${String(result.response.status)} · ${String(Math.round(result.response.ms))} ms`;
    case 'request-failed':
      return 'failed';
    case 'invalid-output':
      return 'unreadable';
    case 'unavailable':
      return 'not sent';
  }
}

export type ApiConsoleProps = {
  send: (request: ApiRequest) => Promise<ConsoleResult>;
  /** Shown while a request waits for the server to come back. */
  restarting: boolean;
};

export function ApiConsole({ send, restarting }: ApiConsoleProps): React.ReactElement {
  const [form, setForm] = useState<RequestForm>(INITIAL);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [shown, setShown] = useState<HistoryEntry | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const ids = useId();

  const update = (patch: Partial<RequestForm>): void => {
    setForm((current) => ({ ...current, ...patch }));
    setProblem(null);
  };

  const hasBody = form.method !== 'GET' && form.method !== 'HEAD';

  const submit = async (): Promise<void> => {
    // The body field is hidden for GET and HEAD; what it still holds (kept
    // for switching back to POST) is not part of this request.
    const built = buildRequest(hasBody ? form : { ...form, body: '' });
    if (!built.ok) {
      setProblem(built.message);
      return;
    }
    setSending(true);
    try {
      const result = await send(built.request);
      const entry: HistoryEntry = { id: Date.now(), form, result };
      setShown(entry);
      setHistory((current) => [entry, ...current].slice(0, MAX_HISTORY));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 text-xs">
      <form
        aria-label="Request"
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex gap-1.5">
          <label htmlFor={`${ids}-method`} className="sr-only">
            Method
          </label>
          <select
            id={`${ids}-method`}
            value={form.method}
            onChange={(event) => update({ method: event.target.value as HttpMethod })}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 font-mono text-zinc-100"
          >
            {HTTP_METHODS.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
          <label htmlFor={`${ids}-path`} className="sr-only">
            Path
          </label>
          <input
            id={`${ids}-path`}
            value={form.path}
            onChange={(event) => update({ path: event.target.value })}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-100"
          />
          <button
            type="submit"
            disabled={sending}
            className="rounded-md bg-sky-600 px-2.5 py-1 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <label className="block text-zinc-400">
          Headers <span className="text-zinc-600">(one per line, Name: value)</span>
          <textarea
            value={form.headersText}
            onChange={(event) => update({ headersText: event.target.value })}
            rows={2}
            spellCheck={false}
            className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-100"
          />
        </label>
        {hasBody && (
          <label className="block text-zinc-400">
            Body
            <textarea
              value={form.body}
              onChange={(event) => update({ body: event.target.value })}
              rows={4}
              spellCheck={false}
              placeholder={'{ "name": "Ada" }'}
              className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-100"
            />
          </label>
        )}
        {problem && (
          <p role="alert" className="text-red-300">
            {problem}
          </p>
        )}
      </form>

      <div className="mt-3" aria-live="polite" aria-label="API result">
        {sending ? (
          <p className="text-sky-300">
            {restarting ? 'Waiting for the server to restart…' : 'Sending…'}
          </p>
        ) : (
          shown && <ResponseView result={shown.result} />
        )}
      </div>

      {history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
            History ({history.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {history.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    setForm(entry.form);
                    setShown(entry);
                    setProblem(null);
                  }}
                  className={`w-full truncate rounded px-1.5 py-0.5 text-left font-mono hover:bg-zinc-800 ${
                    shown?.id === entry.id ? 'text-zinc-100' : 'text-zinc-400'
                  }`}
                >
                  {entry.form.method} {entry.form.path} → {summary(entry.result)}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
