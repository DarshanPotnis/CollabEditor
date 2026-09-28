/**
 * POST /api/ai/step: the model proxy (docs/PLAN-AI.md §6). The request names a
 * server-owned prompt and carries its inputs; the server builds the prompt,
 * picks the shared free tier or the caller's own key, applies the limits, and
 * relays the answer as a stream (ai-stream.ts).
 *
 * The agent's prompt also takes the conversation so far and declares its own
 * tools. Its steps are counted like any other request, with a step cap per
 * session, an admission check before a shared-tier session's first step, and
 * a share of the shared tier's minute so the one-shot helpers keep the rest
 * (agent-admission.ts).
 *
 * The caller's own key arrives in the AI_KEY_HEADER header. It is read here,
 * handed to the gateway for this one call, and never logged or stored: the
 * request logger drops headers (request-logging.ts) and the log line below is
 * metadata only.
 */
import {
  AI_KEY_HEADER,
  AI_STEP_PATH,
  PROMPTS,
  aiKeySchema,
  aiStepRequestSchema,
  conversationSteps,
  type ByokChoice,
} from '@collabcode/shared';
import express, { Router, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { admitAgentStep } from '../../ai/agent-admission.js';
import { createDailyLimiter, type DailyLimits } from '../../ai/daily-limits.js';
import { describeFailure, sharedTierBusy } from '../../ai/failure-messages.js';
import { createMinuteLimit } from '../../ai/minute-limit.js';
import type { ModelGateway, ModelTarget } from '../../ai/model-gateway.js';
import { sharedModelsFor, type SharedModels } from '../../ai/shared-models.js';
import type { ProjectsRepo } from '../../db/projects-repo.js';
import { streamAnswer, type ModelTargets } from '../ai-stream.js';
import { clientKey, type ClientIpSource } from '../client-ip.js';
import { sendApiError } from '../errors.js';

/**
 * Each prompt's input schema and the conversation schema are the real caps;
 * this only bounds parsing. An agent step carries up to 120,000 characters the
 * model reads plus opaque provider data such as Gemini's thought signatures.
 */
const AI_BODY_LIMIT = '512kb';
/** AI requests one visitor may make per minute, shared tier or own key. */
export const DEFAULT_AI_REQUESTS_PER_MINUTE = 20;
/** Of the shared tier's requests per minute, how many agent steps may take. */
export const DEFAULT_AGENT_REQUESTS_PER_MINUTE = 6;
/** Longest a whole model call may take. */
export const DEFAULT_MODEL_CALL_TIMEOUT_MS = 90_000;

/**
 * The shared free tier: the model it calls, a fallback for when that one is
 * busy (shared-models.ts), and the server's key for them.
 */
export type SharedTier = SharedModels & { apiKey: string };

export type AiRouterDeps = {
  gateway: ModelGateway;
  repo: ProjectsRepo;
  clientIpSource: ClientIpSource;
  /** Null when the server has no key, which turns the shared tier off. */
  sharedTier: SharedTier | null;
  limits: DailyLimits;
  /** Shared-tier requests everyone together may start in any 60 seconds. */
  sharedTierPerMinute: number;
  /** How many of those may be agent steps, so the one-shot helpers keep the rest. */
  agentPerMinute?: number;
  /** Requests one visitor may make per minute, shared tier or own key. */
  requestsPerMinute?: number;
  callTimeoutMs?: number;
  now?: () => number;
};

const QUOTA_MESSAGES = {
  global:
    "Today's shared free AI allowance has been used up by everyone together. It resets at midnight Pacific time, or add your own key in AI settings to keep going.",
  ip: "You've used your shared free AI requests for today. They reset at midnight Pacific time, or add your own key in AI settings to keep going.",
  project:
    'This project has used its shared free AI requests for today. They reset at midnight Pacific time, or add your own key in AI settings to keep going.',
} as const;

/**
 * The origin guard in app.ts lets requests without an Origin through, since
 * they are not browser requests. The AI route refuses them: it stops casual
 * scripts from using the shared key, though anyone determined can send the
 * header, so the daily limits remain the real protection.
 */
const requireOrigin: RequestHandler = (req, res, next) => {
  if (req.headers.origin === undefined) {
    sendApiError(res, 'forbidden', 'AI requests must come from the CollabCode app.');
    return;
  }
  next();
};

type OwnKey = { ok: true; key: string | null } | { ok: false; message: string };

function readOwnKey(req: Request, byok: ByokChoice | undefined): OwnKey {
  const header = req.headers[AI_KEY_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined && byok === undefined) return { ok: true, key: null };
  if (raw === undefined || byok === undefined) {
    return { ok: false, message: 'Your own key and its provider must be sent together.' };
  }
  const key = aiKeySchema.safeParse(raw);
  if (!key.success) return { ok: false, message: key.error.issues[0]?.message ?? 'Invalid key.' };
  return { ok: true, key: key.data };
}

export function createAiRouter({
  gateway,
  repo,
  clientIpSource,
  sharedTier,
  limits,
  sharedTierPerMinute,
  agentPerMinute = DEFAULT_AGENT_REQUESTS_PER_MINUTE,
  requestsPerMinute = DEFAULT_AI_REQUESTS_PER_MINUTE,
  callTimeoutMs = DEFAULT_MODEL_CALL_TIMEOUT_MS,
  now,
}: AiRouterDeps): Router {
  const router = Router();
  const daily = createDailyLimiter(limits, now);
  const sharedMinute = createMinuteLimit(sharedTierPerMinute, now);
  const agentMinute = createMinuteLimit(agentPerMinute, now);
  const perMinute = rateLimit({
    windowMs: 60_000,
    limit: requestsPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => clientKey(req, clientIpSource),
    handler: (_req, res) => {
      sendApiError(res, 'rate-limited', 'Too many AI requests. Wait a minute and try again.');
    },
  });

  router.post(
    AI_STEP_PATH,
    requireOrigin,
    perMinute,
    express.json({ limit: AI_BODY_LIMIT }),
    async (req, res) => {
      const body = aiStepRequestSchema.safeParse(req.body);
      if (!body.success) {
        sendApiError(res, 'bad-request', body.error.issues[0]?.message ?? 'Invalid AI request.');
        return;
      }
      const { projectId, promptId, inputs, byok, sessionId, sharedModel } = body.data;
      const prompt = PROMPTS[promptId];
      const toolUse = prompt.toolUse;
      if (!toolUse && body.data.conversation !== undefined) {
        sendApiError(res, 'bad-request', 'This AI prompt does not take a conversation.');
        return;
      }
      const conversation = body.data.conversation ?? [];
      const stepsTaken = conversationSteps(conversation);
      const prepared = prompt.prepare(inputs);
      if (!prepared.ok) {
        sendApiError(res, 'bad-request', prepared.message);
        return;
      }
      const ownKey = readOwnKey(req, byok);
      if (!ownKey.ok) {
        sendApiError(res, 'bad-request', ownKey.message);
        return;
      }
      if (!(await repo.findById(projectId))) {
        sendApiError(res, 'not-found', 'No project with that ID.');
        return;
      }

      if (sharedModel !== undefined && (!toolUse || ownKey.key !== null)) {
        sendApiError(
          res,
          'bad-request',
          'Only an AI teammate session on the shared free tier names its model.',
        );
        return;
      }

      const ipKey = clientKey(req, clientIpSource);
      if (toolUse) {
        const admission = admitAgentStep({
          tier: ownKey.key === null ? 'shared' : 'ownKey',
          stepsTaken,
          remaining: () => daily.remaining({ ipKey, projectId }),
        });
        if (!admission.ok) {
          sendApiError(res, admission.code, admission.message);
          return;
        }
      }

      let targets: ModelTargets;
      let remainingToday: number | null = null;
      let refundDaily: (() => void) | null = null;
      if (ownKey.key !== null && byok !== undefined) {
        targets = [{ provider: byok.provider, model: byok.model, apiKey: ownKey.key }];
      } else {
        if (sharedTier === null) {
          sendApiError(
            res,
            'unavailable',
            'The shared free AI is not set up on this server. Add your own key in AI settings to use AI features.',
          );
          return;
        }
        const models = sharedModelsFor(sharedTier, {
          pinned: sharedModel,
          midSession: toolUse !== undefined && stepsTaken > 0,
        });
        if (!models.ok) {
          sendApiError(res, 'bad-request', models.message);
          return;
        }
        // Checked before the daily allowances, so a busy minute costs nobody a request.
        const waitMs = Math.max(sharedMinute.waitMs(), toolUse ? agentMinute.waitMs() : 0);
        if (waitMs > 0) {
          const busy = sharedTierBusy(waitMs);
          res.set('retry-after', String(Math.ceil(waitMs / 1_000)));
          sendApiError(res, busy.code, busy.message);
          return;
        }
        const verdict = daily.tryConsume({ ipKey, projectId });
        if (!verdict.ok) {
          sendApiError(res, 'quota-exhausted', QUOTA_MESSAGES[verdict.exceeded]);
          return;
        }
        sharedMinute.record();
        if (toolUse) agentMinute.record();
        const target = (model: string): ModelTarget => ({
          provider: 'gemini',
          model,
          apiKey: sharedTier.apiKey,
        });
        const [firstModel, ...otherModels] = models.models;
        targets = [target(firstModel), ...otherModels.map(target)];
        remainingToday = verdict.remaining;
        refundDaily = verdict.refund;
      }

      const ownKeyProvider = byok?.provider ?? null;
      const outcome = await streamAnswer({
        res,
        gateway,
        call: {
          system: prepared.prompt.system,
          messages: prepared.prompt.messages,
          maxOutputTokens: prompt.maxOutputTokens,
          toolUse: toolUse && { use: toolUse, conversation },
        },
        targets,
        finish: { prompt: { id: prompt.id, version: prompt.version }, remainingToday },
        timeoutMs: callTimeoutMs,
        describe: (failure, providerStatus) =>
          describeFailure(failure, providerStatus, ownKeyProvider),
      });

      // Refused for quota or rate reasons, or busy (503), before answering: the
      // request cost nothing, so it should not count against anyone's day.
      const refusedUpFront =
        outcome.status === 'failed' &&
        outcome.firstEventMs === null &&
        (outcome.failure === 'rate-limited' ||
          (outcome.failure === 'unavailable' && outcome.providerStatus === 503));
      if (refusedUpFront && refundDaily) refundDaily();

      // Metadata only: never the inputs, the answer or the key. The model is
      // the last one tried; `attempts` over 1 means the fallback was.
      const used = targets[outcome.attempts - 1] ?? targets[0];
      const meta = {
        promptId: prompt.id,
        promptVersion: prompt.version,
        provider: used.provider,
        model: used.model,
        ownKey: ownKeyProvider !== null,
        ...(toolUse && { agent: { sessionId: sessionId ?? null, step: stepsTaken + 1 } }),
        dailyRefunded: refusedUpFront && refundDaily !== null,
        ...outcome,
      };
      const sharedKeyRefused =
        outcome.status === 'failed' && outcome.failure === 'invalid-key' && !meta.ownKey;
      if (sharedKeyRefused || (outcome.status === 'failed' && outcome.unexpected !== null)) {
        req.log.error({ ai: meta }, 'ai step failed');
      } else if (
        outcome.status === 'failed' &&
        (outcome.failure === 'timeout' || outcome.failure === 'no-answer')
      ) {
        // firstEventMs says whether the provider had started answering.
        req.log.warn({ ai: meta }, 'ai step timed out');
      } else {
        req.log.info({ ai: meta }, 'ai step');
      }
    },
  );

  return router;
}
