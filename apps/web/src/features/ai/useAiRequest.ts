/**
 * Runs AI requests for one panel. The first request waits for the privacy
 * notice to be accepted. The person's own key is read at the moment of
 * sending, so a key changed in settings applies at once. A request is aborted,
 * which also stops the model call on the server, when the person stops it,
 * starts another, or the panel unmounts.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError } from '../../lib/api-error.js';
import { config } from '../../lib/app-config.js';
import { bestEffortStorage } from '../../lib/best-effort-storage.js';
import { browserStorage } from '../../lib/identity.js';
import { streamAiStep, type AiAnswerEvent, type AiStep } from './ai-client.js';
import {
  IDLE_AI_REQUEST,
  aiRequestReducer,
  type AiRequestEvent,
  type AiRequestState,
} from './ai-request-state.js';
import { browserSessionStorage, loadOwnKey } from './byok-store.js';
import { hasAcceptedPrivacyNotice, recordPrivacyNoticeAccepted } from './privacy-consent.js';

export type AiRequestControls = {
  state: AiRequestState;
  /** Sends the step, or first asks for the privacy notice. Replaces any request in flight. */
  start: (step: AiStep) => void;
  /** Accepts the privacy notice and sends the step that was waiting for it. */
  acceptPrivacyNotice: () => void;
  stop: () => void;
  /** Back to idle, whether declining the notice or clearing an answer. */
  dismiss: () => void;
};

function reportInternalError(error: unknown): void {
  // eslint-disable-next-line no-console -- there is no logging service; the browser console is all we have
  console.error('CollabCode AI request', error);
}

async function relay(
  events: AsyncIterable<AiAnswerEvent>,
  id: number,
  signal: AbortSignal,
  dispatch: (event: AiRequestEvent) => void,
): Promise<void> {
  try {
    for await (const event of events) {
      dispatch(
        event.type === 'text-delta'
          ? { type: 'text', id, text: event.text }
          : { type: 'finish', id, finish: event },
      );
    }
  } catch (error) {
    // Whatever aborted this request (a stop, a newer request) already updated the state.
    if (signal.aborted) return;
    if (error instanceof ApiError) {
      dispatch({ type: 'fail', id, failure: { code: error.code, message: error.message } });
      return;
    }
    reportInternalError(error);
    dispatch({
      type: 'fail',
      id,
      failure: {
        code: 'internal',
        message: 'Something went wrong with the AI request. Try again.',
      },
    });
  }
}

export function useAiRequest(): AiRequestControls {
  const [state, dispatch] = useReducer(aiRequestReducer, IDLE_AI_REQUEST);
  const inFlight = useRef<AbortController | null>(null);
  const lastId = useRef(0);
  const [consentStorage] = useState(() => bestEffortStorage(browserStorage()));
  const [consented, setConsented] = useState(() => hasAcceptedPrivacyNotice(consentStorage));

  const abortInFlight = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  const send = useCallback(
    (step: AiStep) => {
      abortInFlight();
      const controller = new AbortController();
      inFlight.current = controller;
      lastId.current += 1;
      const id = lastId.current;
      dispatch({ type: 'send', id, step });
      const events = streamAiStep({
        apiUrl: config.apiUrl,
        step,
        ownKey: loadOwnKey(browserSessionStorage()),
        signal: controller.signal,
      });
      void relay(events, id, controller.signal, dispatch);
    },
    [abortInFlight],
  );

  const start = useCallback(
    (step: AiStep) => {
      if (consented) {
        send(step);
        return;
      }
      abortInFlight();
      dispatch({ type: 'ask-consent', step });
    },
    [consented, send, abortInFlight],
  );

  const pendingStep = state.phase === 'needs-consent' ? state.step : null;
  const acceptPrivacyNotice = useCallback(() => {
    recordPrivacyNoticeAccepted(consentStorage);
    setConsented(true);
    if (pendingStep) send(pendingStep);
  }, [consentStorage, pendingStep, send]);

  const stop = useCallback(() => {
    abortInFlight();
    dispatch({ type: 'stop' });
  }, [abortInFlight]);

  const dismiss = useCallback(() => {
    abortInFlight();
    dispatch({ type: 'dismiss' });
  }, [abortInFlight]);

  // Unmounting aborts the request in flight. Requests start from the person's
  // actions, never from an effect, so StrictMode's rehearsal unmount finds
  // nothing to abort and can never send a request twice.
  useEffect(() => abortInFlight, [abortInFlight]);

  return { state, start, acceptPrivacyNotice, stop, dismiss };
}
