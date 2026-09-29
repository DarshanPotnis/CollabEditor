/**
 * What the eval project's key may spend, per model: requests a minute and a
 * day on Google's free tier, which are per Google Cloud project. The pacer
 * keeps to the first and the ledger to the second, so an eval run never
 * spends more than the project has.
 *
 * From AI Studio's rate-limit page for the eval project, collabcode-evals, in
 * September 2026 (docs/evals/README.md says how to read them). A run can
 * set others with --rpm and --rpd.
 */
export type ModelLimits = {
  /** Requests a minute. */
  rpm: number;
  /** Requests a day, reset at midnight Pacific time. */
  rpd: number;
};

export const MODEL_LIMITS: Readonly<Record<string, ModelLimits>> = {
  'gemini-3.5-flash-lite': { rpm: 15, rpd: 500 },
  'gemini-3.8-flash': { rpm: 5, rpd: 20 },
};

/** For a model not listed: very little, so a mistyped id cannot spend much. */
export const UNKNOWN_MODEL_LIMITS: ModelLimits = { rpm: 2, rpd: 10 };

export function limitsFor(model: string, overrides: Partial<ModelLimits> = {}): ModelLimits {
  return { ...(MODEL_LIMITS[model] ?? UNKNOWN_MODEL_LIMITS), ...overrides };
}
