/**
 * POST /api/ai/step: the model proxy (docs/PLAN-AI.md §6). The request names a
 * server-owned prompt and carries its inputs; the server builds the prompt,
 * picks the shared free tier or the caller's own key, applies the limits, and
 * relays the answer as a stream (ai-stream.ts).
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
  type ByokChoice,
} from '@collabcode/shared';
import express, { Router, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { createDailyLimiter, type DailyLimits } from '../../ai/daily-limits.js';
import { describeFailure } from '../../ai/failure-messages.js';
import type { ModelGateway, ModelTarget } from '../../ai/model-gateway.js';
import type { ProjectsRepo } from '../../db/projects-repo.js';
import { streamAnswer } from '../ai-stream.js';
import { clientKey, type ClientIpSource } from '../client-ip.js';
import { sendApiError } from '../errors.js';

/** Each prompt's input schema is the real cap; this only bounds parsing. */
const AI_BODY_LIMIT = '256kb';
/** AI requests one visitor may make per minute, shared tier or own key. */
export const DEFAULT_AI_REQUESTS_PER_MINUTE = 20;
/** Longest a whole model call may take. */
export const DEFAULT_MODEL_CALL_TIMEOUT_MS = 90_000;

/** The shared free tier: the model it calls and the server's key for it. */
export type SharedTier = { model: string; apiKey: string };

export type AiRouterDeps = {
  gateway: ModelGateway;
  repo: ProjectsRepo;
  clientIpSource: ClientIpSource;
  /** Null when the server has no key, which turns the shared tier off. */
  sharedTier: SharedTier | null;
  limits: DailyLimits;
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
  requestsPerMinute = DEFAULT_AI_REQUESTS_PER_MINUTE,
  callTimeoutMs = DEFAULT_MODEL_CALL_TIMEOUT_MS,
  now,
}: AiRouterDeps): Router {
  const router = Router();
  const daily = createDailyLimiter(limits, now);
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
      const { projectId, promptId, inputs, byok } = body.data;
      const prompt = PROMPTS[promptId];
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

      let target: ModelTarget;
      let remainingToday: number | null = null;
      if (ownKey.key !== null && byok !== undefined) {
        target = { provider: byok.provider, model: byok.model, apiKey: ownKey.key };
      } else {
        if (sharedTier === null) {
          sendApiError(
            res,
            'unavailable',
            'The shared free AI is not set up on this server. Add your own key in AI settings to use AI features.',
          );
          return;
        }
        const verdict = daily.tryConsume({ ipKey: clientKey(req, clientIpSource), projectId });
        if (!verdict.ok) {
          sendApiError(res, 'quota-exhausted', QUOTA_MESSAGES[verdict.exceeded]);
          return;
        }
        target = { provider: 'gemini', model: sharedTier.model, apiKey: sharedTier.apiKey };
        remainingToday = verdict.remaining;
      }

      const ownKeyProvider = byok?.provider ?? null;
      const outcome = await streamAnswer({
        res,
        gateway,
        call: {
          target,
          system: prepared.prompt.system,
          messages: prepared.prompt.messages,
          maxOutputTokens: prompt.maxOutputTokens,
        },
        finish: {
          prompt: { id: prompt.id, version: prompt.version },
          model: { provider: target.provider, id: target.model },
          remainingToday,
        },
        timeoutMs: callTimeoutMs,
        describe: (failure, providerStatus) =>
          describeFailure(failure, providerStatus, ownKeyProvider),
      });

      // Metadata only: never the inputs, the answer or the key.
      const meta = {
        promptId: prompt.id,
        promptVersion: prompt.version,
        provider: target.provider,
        model: target.model,
        ownKey: ownKeyProvider !== null,
        ...outcome,
      };
      const sharedKeyRefused =
        outcome.status === 'failed' && outcome.failure === 'invalid-key' && !meta.ownKey;
      if (sharedKeyRefused || (outcome.status === 'failed' && outcome.unexpected !== null)) {
        req.log.error({ ai: meta }, 'ai step failed');
      } else {
        req.log.info({ ai: meta }, 'ai step');
      }
    },
  );

  return router;
}
