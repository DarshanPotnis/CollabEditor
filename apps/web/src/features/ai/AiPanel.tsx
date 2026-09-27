/**
 * The AI view of the right-hand pane: one request at a time, from the privacy
 * notice through the streamed answer to what it cost, plus AI settings. The
 * request itself is owned by the workspace (useAiRequest), so switching to
 * the Run view never stops it.
 */
import { useState } from 'react';
import { Settings } from 'lucide-react';
import type { AiRequestState } from './ai-request-state.js';
import { describeStep, finishNote, keyStatus, settingsAction, usageLine } from './ai-messages.js';
import { AiSettingsDialog } from './AiSettingsDialog.js';
import { AiText } from './AiText.js';
import { PrivacyNotice } from './PrivacyNotice.js';
import type { AiRequestControls } from './useAiRequest.js';
import { useOwnKeyChoice } from './useOwnKeyChoice.js';

export type AiPanelProps = {
  request: AiRequestControls;
};

type ActiveState = Exclude<AiRequestState, { phase: 'idle' | 'needs-consent' }>;

const STATUS_TEXT: Record<ActiveState['phase'], string> = {
  waiting: 'Thinking…',
  streaming: 'Answering…',
  done: 'Answer complete.',
  failed: 'The request failed.',
  stopped: 'Stopped.',
};

function PanelButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-zinc-500"
    >
      {children}
    </button>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <div className="space-y-2 text-sm text-zinc-400">
      <p className="text-zinc-300">Ask AI about your code.</p>
      <p>
        Select code in the editor, then right-click and choose Explain with AI or Edit with AI. When
        a run crashes, Explain with AI appears in the Run view.
      </p>
      <p>Only you see these answers. Edits you apply reach everyone like your own typing.</p>
    </div>
  );
}

function RequestView({
  state,
  request,
  usingOwnKey,
  onOpenSettings,
}: {
  state: ActiveState;
  request: AiRequestControls;
  usingOwnKey: boolean;
  onOpenSettings: () => void;
}): React.ReactElement {
  const inFlight = state.phase === 'waiting' || state.phase === 'streaming';
  const retry = (): void => request.start(state.step);
  const note = state.phase === 'done' ? finishNote(state.finish) : null;
  const action = state.phase === 'failed' ? settingsAction(state.failure, usingOwnKey) : null;

  return (
    <div className="space-y-3">
      <p className="line-clamp-3 text-xs text-zinc-500">{describeStep(state.step)}</p>
      {state.phase !== 'waiting' && state.text !== '' && <AiText text={state.text} />}
      <p
        role="status"
        className={`text-xs ${state.phase === 'failed' ? 'sr-only' : 'text-zinc-500'}`}
      >
        {STATUS_TEXT[state.phase]}
      </p>
      {note !== null && <p className="text-xs text-amber-200">{note}</p>}
      {state.phase === 'failed' && (
        <p
          role="alert"
          className="rounded-md border border-red-900/60 bg-red-950/40 p-2 text-sm text-red-200"
        >
          {state.failure.message}
        </p>
      )}
      {state.phase === 'done' && <p className="text-xs text-zinc-500">{usageLine(state.finish)}</p>}
      <div className="flex flex-wrap gap-2">
        {inFlight ? (
          <PanelButton onClick={request.stop}>Stop</PanelButton>
        ) : (
          <>
            {state.phase !== 'done' && <PanelButton onClick={retry}>Try again</PanelButton>}
            {action !== null && <PanelButton onClick={onOpenSettings}>{action}</PanelButton>}
            <PanelButton onClick={request.dismiss}>Clear</PanelButton>
          </>
        )}
      </div>
    </div>
  );
}

export function AiPanel({ request }: AiPanelProps): React.ReactElement {
  const ownKey = useOwnKeyChoice();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { state } = request;

  return (
    <section aria-labelledby="ai-heading" className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <h2 id="ai-heading" className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
          AI
        </h2>
        <p className="min-w-0 flex-1 truncate text-right text-xs text-zinc-500">
          {keyStatus(ownKey.choice)}
        </p>
        <button
          type="button"
          aria-label="AI settings"
          title="AI settings"
          onClick={() => setSettingsOpen(true)}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-1 focus-visible:ring-sky-500 focus-visible:outline-none"
        >
          <Settings className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.phase === 'idle' && <EmptyState />}
        {state.phase === 'needs-consent' && (
          <PrivacyNotice onAccept={request.acceptPrivacyNotice} onCancel={request.dismiss} />
        )}
        {state.phase !== 'idle' && state.phase !== 'needs-consent' && (
          <RequestView
            state={state}
            request={request}
            usingOwnKey={ownKey.choice !== null}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </div>

      {settingsOpen && (
        <AiSettingsDialog settings={ownKey} onClose={() => setSettingsOpen(false)} />
      )}
    </section>
  );
}
