/**
 * AI settings: use the shared free tier, or the person's own key for one of
 * the supported providers. Built on the native <dialog> element like
 * ConfirmDialog; it opens when mounted and the parent unmounts it to close.
 *
 * The key is only ever in the password field until it is saved; after that
 * the dialog knows which provider and model are in use, never the key. Leaving
 * the field empty keeps the saved key when only the model changes.
 */
import { useEffect, useId, useRef, useState } from 'react';
import {
  AI_PROVIDERS,
  AI_PROVIDER_LABELS,
  BYOK_MODELS,
  byokChoiceSchema,
  type AiProvider,
} from '@collabcode/shared';
import type { OwnKeySettings } from './useOwnKeyChoice.js';

export type AiSettingsDialogProps = {
  settings: OwnKeySettings;
  onClose: () => void;
};

const FIELD =
  'mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-sky-500 focus:outline-none';

function isProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export function AiSettingsDialog({ settings, onClose }: AiSettingsDialogProps): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const saved = settings.choice;
  const [provider, setProvider] = useState<AiProvider>(saved?.provider ?? 'gemini');
  const [model, setModel] = useState<string>(saved?.model ?? BYOK_MODELS.gemini[0]);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => {
      element.close();
    };
  }, []);

  const chooseProvider = (next: string): void => {
    if (!isProvider(next)) return;
    setProvider(next);
    setModel(BYOK_MODELS[next][0]);
    setError(null);
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const choice = byokChoiceSchema.safeParse({ provider, model });
    if (!choice.success) {
      setError('Choose a model from the list.');
      return;
    }
    const result =
      key.trim() === ''
        ? settings.changeModel(choice.data)
        : settings.save({ choice: choice.data, key });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setKey('');
    onClose();
  };

  const forget = (): void => {
    settings.forget();
    onClose();
  };

  const keyHint =
    saved?.provider === provider
      ? 'Saved. Leave empty to keep it, or paste a new key to replace it.'
      : `Paste your ${AI_PROVIDER_LABELS[provider]} API key`;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${ids}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-5 text-zinc-100 shadow-xl backdrop:bg-black/60"
    >
      <form onSubmit={submit}>
        <h2 id={`${ids}-title`} className="text-base font-semibold">
          AI settings
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          {saved === null
            ? 'You are using the shared free tier, which has a daily limit for everyone. Add your own key to use AI without it.'
            : `You are using your own ${AI_PROVIDER_LABELS[saved.provider]} key with ${saved.model}.`}
        </p>

        <fieldset className="mt-4 space-y-3">
          <legend className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            Your own key
          </legend>
          <label className="block text-sm">
            Provider
            <select
              value={provider}
              onChange={(event) => chooseProvider(event.target.value)}
              className={FIELD}
            >
              {AI_PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {AI_PROVIDER_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Model
            <select
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setError(null);
              }}
              className={FIELD}
            >
              {BYOK_MODELS[provider].map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            API key
            <input
              type="password"
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                setError(null);
              }}
              placeholder={keyHint}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${ids}-key-note`}
              className={FIELD}
            />
          </label>
          <p id={`${ids}-key-note`} className="text-xs text-zinc-500">
            Kept in this browser tab only, and gone when you close it. Each AI request sends it to
            the CollabCode server, which holds it in memory just long enough to pass it to{' '}
            {AI_PROVIDER_LABELS[provider]}, and never stores or logs it.
          </p>
        </fieldset>

        {error !== null && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          {saved !== null && (
            <button
              type="button"
              onClick={forget}
              className="mr-auto rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:text-zinc-100"
            >
              Forget my key
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-white"
          >
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
