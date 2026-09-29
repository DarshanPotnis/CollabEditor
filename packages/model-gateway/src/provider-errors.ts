/**
 * Turns whatever a provider call threw into a ModelCallError. The original
 * error is never kept: the SDK's APICallError carries `requestBodyValues`
 * (the whole prompt, project code included) and the provider's response body,
 * and pino would log both if it reached a logger.
 */
import { APICallError, RetryError } from 'ai';
import { ModelCallError } from './model-gateway.js';

/**
 * Google answers a bad key with 400 INVALID_ARGUMENT rather than 401, and says
 * why only in the error details. The body is only searched for this reason
 * code, never logged or passed on.
 */
const GOOGLE_INVALID_KEY_REASON = 'API_KEY_INVALID';

export function toModelCallError(error: unknown, signal: AbortSignal): ModelCallError {
  if (error instanceof ModelCallError) return error;
  if (signal.aborted) return new ModelCallError('aborted');
  if (RetryError.isInstance(error)) return toModelCallError(error.lastError, signal);
  if (!APICallError.isInstance(error)) return new ModelCallError('unavailable');

  const status = error.statusCode ?? null;
  if (status === 401 || status === 403) return new ModelCallError('invalid-key', status);
  if (status === 429) return new ModelCallError('rate-limited', status);
  if (status === 400 && error.responseBody?.includes(GOOGLE_INVALID_KEY_REASON)) {
    return new ModelCallError('invalid-key', status);
  }
  if (status !== null && status >= 400 && status < 500) {
    return new ModelCallError('rejected', status);
  }
  return new ModelCallError('unavailable', status);
}
