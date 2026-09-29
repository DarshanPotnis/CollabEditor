/**
 * The AI teammate session for the agent panel: start, Stop, Undo AI changes,
 * Download trace, Dismiss. A session starts only from a click and is dismissed
 * when the panel goes away or the project changes, so no session outlives the
 * workspace it works in.
 *
 * A replay ("Watch a demo") is the same session with the recording's answers
 * in place of a model: it needs no consent, since nothing goes to a model, and
 * it stops at the first place today's tools answer differently from the
 * recording (the core's replay monitor). Its Download trace gives the
 * recording, so a replay's own trace is never mistaken for a live session.
 */
import {
  createLiveTypist,
  createReplayModel,
  createReplayMonitor,
  instantTypist,
  planReplay,
  startingProject,
  type AgentEvent,
  type AgentTrace,
} from '@collabcode/agent';
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
  /** Replays a recorded session into this project, with no model. */
  startReplay: (recording: AgentTrace) => void;
  /** The recording being replayed, or last replayed, for "View the recorded session". */
  recording: AgentTrace | null;
  /** Whether the project has loaded, so a replay can check it has the recording's files. */
  replayReady: boolean;
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
  /** Whether the project's document has had its first sync (useProject). */
  hasSynced: boolean;
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
  hasSynced,
  host,
  runtime,
}: UseAgentSessionOptions): AgentSessionControls {
  const [state, dispatch] = useReducer(agentSessionReducer, IDLE_AGENT_SESSION);
  const live = useRef<AgentSession | null>(null);
  const [recording, setRecording] = useState<AgentTrace | null>(null);
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
    (goal: string, replaying: AgentTrace | null = null) => {
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
      // A replay asks no model, so it never uses a key.
      const ownKey = replaying ? null : loadOwnKey(browserSessionStorage());
      const monitor = replaying ? createReplayMonitor(replaying) : null;
      const onEvent = (event: AgentEvent): void => {
        if (event.type === 'crashed') reportInternalError(event.error);
        const divergence = monitor?.observe(event) ?? null;
        if (divergence) {
          dispatch({ type: 'replay-diverged', divergence });
          live.current?.stop();
        }
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
          ...(replaying && { replay: { model: createReplayModel(replaying, systemClock) } }),
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
            modelName: replaying
              ? 'The recording'
              : ownKey
                ? MODEL_NAMES[ownKey.choice.provider]
                : 'Gemini',
            agentClientId: agent.clientId,
          });
          agent.run().then(
            (result) => {
              if (live.current !== agent) return;
              dispatch({ type: 'recorded', trace: result.trace });
              if (agent.undoPreview().empty) dispatch({ type: 'nothing-to-undo' });
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

  const startReplay = useCallback(
    (trace: AgentTrace) => {
      setRecording(trace);
      // Before the first sync the document is empty, and the check would
      // refuse a project that has exactly the recording's files.
      const plan = session && hasSynced ? planReplay(trace, startingProject(session.doc)) : null;
      const model = trace.steps.find((step) => step.model !== null)?.model ?? null;
      dispatch({
        type: 'replay-requested',
        goal: trace.inputs.goal,
        replay: {
          recordedAt: trace.startedAt,
          prompt:
            trace.prompt === null ? null : `${trace.prompt.id}@${String(trace.prompt.version)}`,
          model: model?.id ?? null,
        },
      });
      if (plan === null) {
        dispatch({
          type: 'start-failed',
          message: 'The project is still connecting. Try again in a moment.',
        });
        return;
      }
      if (!plan.ok) {
        dispatch({ type: 'start-failed', message: plan.reason });
        return;
      }
      begin(plan.goal, trace);
    },
    [session, hasSynced, begin],
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
    // A replay's download is the recording it played, never the replay's own trace.
    const trace = state.phase === 'ended' && state.replay ? recording : live.current?.trace();
    if (trace) downloadTrace(trace);
  }, [state, recording]);

  const dismiss = useCallback(() => {
    end();
    dispatch({ type: 'dismiss' });
  }, [end]);

  return {
    state,
    start,
    startReplay,
    recording,
    replayReady: session !== null && hasSynced,
    acceptPrivacyNotice,
    stop,
    requestUndo,
    confirmUndo: performUndo,
    cancelUndo,
    downloadTrace: saveTrace,
    dismiss,
  };
}
