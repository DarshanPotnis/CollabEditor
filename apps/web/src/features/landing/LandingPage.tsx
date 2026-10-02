import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Users } from 'lucide-react';
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from '@collabcode/shared';
import { ApiError } from '../../lib/api-error.js';
import { createProject, fetchProject, pingHealth } from '../../lib/api.js';
import { DEMO } from '../agent/demo-recording.js';
import { useSlowFlag } from '../../lib/useSlowFlag.js';
import { projectIdFromInput } from './join-input.js';
import { LandingFooter } from './LandingFooter.js';
import { LandingHero } from './LandingHero.js';

const COLD_START_AFTER_MS = 2_000;

export function LandingPage(): React.ReactElement {
  const navigate = useNavigate();
  const [template, setTemplate] = useState<TemplateId>('express-api');
  const [busy, setBusy] = useState<'creating' | 'joining' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState('');
  const slow = useSlowFlag(busy !== null, COLD_START_AFTER_MS);

  // Start the server waking while the visitor is still reading, so the first
  // real request does not pay the whole cold start.
  useEffect(() => {
    pingHealth();
  }, []);

  async function create(): Promise<void> {
    setBusy('creating');
    setError(null);
    try {
      const project = await createProject({ template });
      void navigate(`/p/${project.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create the project.');
      setBusy(null);
    }
  }

  /** A fresh project from the recording's template, opened with the replay offered. */
  async function watchDemo(): Promise<void> {
    setBusy('demo');
    setError(null);
    try {
      const project = await createProject({ template: DEMO.template, name: DEMO.projectName });
      void navigate(`/p/${project.id}?demo=${DEMO.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create the demo project.');
      setBusy(null);
    }
  }

  async function join(event: FormEvent): Promise<void> {
    event.preventDefault();
    const id = projectIdFromInput(joinInput);
    if (!id) {
      setError('That does not look like a project link or ID.');
      return;
    }

    setBusy('joining');
    setError(null);
    try {
      const project = await fetchProject(id);
      if (!project) {
        setError('There is no project with that ID.');
        setBusy(null);
        return;
      }
      void navigate(`/p/${project.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not reach the server.');
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-10 px-6 py-12">
      <main className="flex flex-1 flex-col justify-center gap-10">
        <LandingHero
          onWatchDemo={() => void watchDemo()}
          loading={busy === 'demo'}
          disabled={busy !== null}
        />

        <section aria-labelledby="create-heading" className="space-y-3">
          <h2 id="create-heading" className="text-sm font-medium text-zinc-300">
            Start a project
          </h2>
          <p className="text-sm text-zinc-400">
            Everyone edits the same project at once and sees each other&rsquo;s cursors, and nothing
            is lost when someone joins late or drops offline.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {TEMPLATE_IDS.map((id) => {
              const option = TEMPLATES[id];
              const selected = template === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTemplate(id)}
                  className={`rounded-lg border p-4 text-left transition ${
                    selected
                      ? 'border-zinc-300 bg-zinc-900'
                      : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-1 block text-xs text-zinc-400">{option.description}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void create()}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white disabled:opacity-60"
          >
            {busy === 'creating' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ArrowRight className="size-4" aria-hidden />
            )}
            Create project
          </button>
        </section>

        <section aria-labelledby="join-heading" className="space-y-3">
          <h2 id="join-heading" className="text-sm font-medium text-zinc-300">
            Or join one
          </h2>
          <form onSubmit={(event) => void join(event)} className="flex gap-2">
            <label htmlFor="join" className="sr-only">
              Project link or ID
            </label>
            <input
              id="join"
              value={joinInput}
              onChange={(event) => setJoinInput(event.target.value)}
              placeholder="Paste a project link or ID"
              className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500 disabled:opacity-60"
            >
              {busy === 'joining' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Users className="size-4" aria-hidden />
              )}
              Join
            </button>
          </form>
        </section>

        <div aria-live="polite" className="min-h-10 space-y-1 text-sm">
          {error && <p className="text-red-300">{error}</p>}
          {busy && slow && (
            <p className="text-zinc-400">
              Waking up the server — it sleeps when nobody is using it, so this can take up to a
              minute.
            </p>
          )}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
