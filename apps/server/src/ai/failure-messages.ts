/**
 * What to tell a person when a model call fails, as an API error code and a
 * message written to be shown as-is. Whether the shared key or the caller's own
 * key was used changes the advice: a refused shared key is our problem, not
 * theirs, and a busy shared tier is a reason to suggest their own key.
 */
import { AI_PROVIDER_LABELS, type AiProvider, type ApiErrorCode } from '@collabcode/shared';
import type { ModelCallFailure } from './model-gateway.js';

/** Why a stream ended early, as far as the route can tell. */
export type StepFailure = Exclude<ModelCallFailure, 'aborted'> | 'timeout';

export type FailureMessage = { code: ApiErrorCode; message: string };

export function describeFailure(
  failure: StepFailure,
  statusCode: number | null,
  ownKeyProvider: AiProvider | null,
): FailureMessage {
  const provider = ownKeyProvider === null ? null : AI_PROVIDER_LABELS[ownKeyProvider];
  switch (failure) {
    case 'invalid-key':
      return provider === null
        ? {
            code: 'unavailable',
            message:
              'The shared AI is not working right now. Try again later, or add your own key in AI settings.',
          }
        : {
            code: 'invalid-key',
            message: `${provider} refused your key. Check it in AI settings.`,
          };
    case 'rate-limited':
      return provider === null
        ? {
            code: 'rate-limited',
            message:
              'The shared free AI is busy right now. Try again in a minute, or add your own key in AI settings.',
          }
        : {
            code: 'rate-limited',
            message: `${provider} is rate limiting your key right now. Wait a moment and try again.`,
          };
    case 'rejected':
      return {
        code: 'bad-request',
        message: `The AI provider refused this request${statusCode === null ? '' : ` (HTTP ${String(statusCode)})`}.${
          provider === null ? '' : ' Check that your key can use the model you chose.'
        }`,
      };
    case 'unavailable':
      return {
        code: 'unavailable',
        message: 'The AI provider is not answering right now. Try again in a minute.',
      };
    case 'timeout':
      return {
        code: 'unavailable',
        message: 'The AI took too long to answer. Try again, perhaps with a smaller selection.',
      };
  }
}
