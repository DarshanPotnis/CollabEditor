/**
 * Which of the shared tier's Gemini models a request may use, in the order to
 * try them (docs/PLAN-AI.md §6.1).
 *
 * - A one-shot helper, or an agent session's first step: the default model,
 *   then the fallback (AI_FALLBACK_MODEL) if one is configured. The fallback is
 *   tried only when the default is busy before answering (ai-stream.ts).
 * - Any later agent step: only the model its session started on, which the
 *   client names from the first step's `finish`. The conversation carries that
 *   model's thought signatures, so a session never changes models part way.
 */

export type SharedModels = { model: string; fallbackModel?: string | null };

export type SharedModelChoice =
  { ok: true; models: readonly [string, ...string[]] } | { ok: false; message: string };

export function sharedModelsFor(
  tier: SharedModels,
  request: { pinned: string | undefined; midSession: boolean },
): SharedModelChoice {
  const fallback = tier.fallbackModel ?? null;
  if (request.pinned !== undefined) {
    return request.pinned === tier.model || request.pinned === fallback
      ? { ok: true, models: [request.pinned] }
      : {
          ok: false,
          message:
            'The shared AI model changed since this session started. Start a new session to continue.',
        };
  }
  if (request.midSession || fallback === null) return { ok: true, models: [tier.model] };
  return { ok: true, models: [tier.model, fallback] };
}
