/**
 * The AI teammate session for the agent panel: start, Stop, Undo AI changes,
 * Download trace, Dismiss. A session starts only from a click and is dismissed
 * when the panel goes away or the project changes, so no session outlives the
 * workspace it works in.
 */
import { createLiveTypist, instantTypist, type AgentEvent } from '@collabcode/agent';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ProjectSession } from '../../collab/useProject.js';
import { config } from '../../lib/app-config.js';
import { bestEffortStorage } from '../../lib/best-effort-storage.js';
import { browserStorage } from '../../lib/identity.js';
import { browserSessionStorage, loadOwnKey, type OwnKey } from '../ai/byok-store.js';
import { hasAcceptedPrivacyNotice, recordPrivacyNoticeAccepted } from '../ai/privacy-consent.js';
import type { RuntimeControls } from '../runtime/useRuntime.js';
import { loadLiveTyping } from './agent-preferences.js';
import { startAgentSession, type AgentSession } from './agent-session.js';
import {
  IDLE_AGENT_SESSION,
  agentSessionReducer,
  type AgentSessionState,
} from './agent-session-state.js';
import { systemClock } from './system-clock.js';
import { downloadTrace } from './trace-download.js';

export type AgentSessionControls = {
  state: AgentSessionState;
  start: (goal: string) => void;
  acceptPrivacyNotice: () => void;
  stop: () => void;
  requestUndo: () => void;
  confirmUndo: () => void;
  cancelUndo: () => void;
  downloadTrace: () => void;
  dismiss: () => void;
};

export type UseAgentSessionOptions = {
  projectId: string;
  session: ProjectSession | null;
  host: { userId: string; name: string };
  runtime: RuntimeControls;
};

const MODEL_NAMES: Readonly<Record<OwnKey['choice']['provider'], string>> = {
  gemini: 'Gemini',
  anthropic: 'Claude',
  openai: 'OpenAI',
};

function reportInternalError(error: unknown): void {
  // eslint-disable-next-line no-console -- there is no logging service; the browser console is all we have
  console.error('CollabCode AI teammate', error);
}

export function useAgentSession({
  projectId,
  session,
  host,
  runtime,
}: UseAgentSessionOptions): AgentSessionControls {
  const [state, dispatch] = useReducer(agentSessionReducer, IDLE_AGENT_SESSION);
  const live = useRef<AgentSession | null>(null);
  const starting = useRef<AbortController | null>(null);
  const [consentStorage] = useState(() => bestEffortStorage(browserStorage()));
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  }, [host]);

  const end = useCallback(() => {
    starting.current?.abort();
    starting.current = null;
    live.current?.dismiss();
    live.current = null;
  }, []);

  // A session belongs to one project connection; leaving it ends the session.
  useEffect(() => end, [session, end]);

  const begin = useCallback(
    (goal: string) => {
      const runner = runtime.runner();
      if (!session || !runner) {
        dispatch({
          type: 'start-failed',
          message: 'The project is still connecting. Try again in a moment.',
        });
        return;
      }
      end();
      const controller = new AbortController();
      starting.current = controller;
      const ownKey = loadOwnKey(browserSessionStorage());
      const onEvent = (event: AgentEvent): void => {
        if (event.type === 'crashed') reportInternalError(event.error);
        dispatch({ type: 'agent', event, at: Date.now() });
      };
      startAgentSession(
        goal,
        {
          projectId,
          collabUrl: config.collabUrl,
          apiUrl: config.apiUrl,
          hostDoc: session.doc,
          host: hostRef.current,
          runtime: { ...runner, output: runtime.output },
          ownKey,
          // A hidden tab's timers are throttled, so it types at once.
          typist: loadLiveTyping()
            ? createLiveTypist(systemClock, () => document.visibilityState === 'hidden')
            : instantTypist,
          onEvent,
          onNotice: (message) => dispatch({ type: 'notice', message }),
        },
        controller.signal,
      ).then(
        (agent) => {
          if (controller.signal.aborted) {
            agent.dismiss();
            return;
          }
          starting.current = null;
          live.current = agent;
          dispatch({
            type: 'started',
            maxSteps: agent.maxSteps,
            modelName: ownKey ? MODEL_NAMES[ownKey.choice.provider] : 'Gemini',
            agentClientId: agent.clientId,
          });
          agent.run().then(
            () => {
              if (live.current === agent && agent.undoPreview().empty) {
                dispatch({ type: 'nothing-to-undo' });
              }
            },
            (error: unknown) => {
              reportInternalError(error);
              dispatch({ type: 'notice', message: 'Something went wrong in the AI teammate.' });
            },
          );
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          starting.current = null;
          dispatch({
            type: 'start-failed',
            message: error instanceof Error ? error.message : 'The AI teammate could not start.',
          });
        },
      );
    },
    [projectId, session, runtime, end],
  );

  const start = useCallback(
    (goal: string) => {
      const consented = hasAcceptedPrivacyNotice(consentStorage);
      dispatch({ type: 'request', goal, consented });
      if (consented) begin(goal);
    },
    [consentStorage, begin],
  );

  const acceptPrivacyNotice = useCallback(() => {
    if (state.phase !== 'needs-consent') return;
    recordPrivacyNoticeAccepted(consentStorage);
    dispatch({ type: 'consented' });
    begin(state.goal);
  }, [state, consentStorage, begin]);

  const stop = useCallback(() => {
    if (starting.current) {
      starting.current.abort();
      starting.current = null;
      dispatch({ type: 'start-failed', message: 'Stopped before it started.' });
      return;
    }
    live.current?.stop();
  }, []);

  const performUndo = useCallback(() => {
    const agent = live.current;
    if (!agent) return;
    const { summary, skipped } = agent.undo();
    dispatch({ type: 'undone', summary, skipped });
  }, []);

  const requestUndo = useCallback(() => {
    const preview = live.current?.undoPreview();
    if (!preview || preview.empty) {
      dispatch({ type: 'nothing-to-undo' });
      return;
    }
    if (preview.changedPaths.length > 0) {
      dispatch({ type: 'undo-asked', changedPaths: preview.changedPaths });
      return;
    }
    performUndo();
  }, [performUndo]);

  const cancelUndo = useCallback(() => dispatch({ type: 'undo-cancelled' }), []);

  const saveTrace = useCallback(() => {
    const trace = live.current?.trace();
    if (trace) downloadTrace(trace);
  }, []);

  const dismiss = useCallback(() => {
    end();
    dispatch({ type: 'dismiss' });
  }, [end]);

  return {
    state,
    start,
    acceptPrivacyNotice,
    stop,
    requestUndo,
    confirmUndo: performUndo,
    cancelUndo,
    downloadTrace: saveTrace,
    dismiss,
  };
}
