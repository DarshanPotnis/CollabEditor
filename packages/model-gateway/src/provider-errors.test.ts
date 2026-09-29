import { APICallError, RetryError } from 'ai';
import { describe, expect, it } from 'vitest';
import { ModelCallError } from './model-gateway.js';
import { toModelCallError } from './provider-errors.js';

const live = new AbortController().signal;

function apiError(statusCode: number | undefined, responseBody = '{}'): APICallError {
  return new APICallError({
    message: 'provider said no',
    url: 'https://provider.example/v1/generate',
    requestBodyValues: { prompt: 'SECRET PROJECT CODE' },
    ...(statusCode === undefined ? {} : { statusCode }),
    responseBody,
    isRetryable: false,
  });
}

describe('toModelCallError', () => {
  it.each([
    [401, 'invalid-key'],
    [403, 'invalid-key'],
    [429, 'rate-limited'],
    [400, 'rejected'],
    [404, 'rejected'],
    [413, 'rejected'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('maps HTTP %i to %s', (status, failure) => {
    const mapped = toModelCallError(apiError(status), live);
    expect(mapped.failure).toBe(failure);
    expect(mapped.statusCode).toBe(status);
  });

  it("recognises Google's bad-key answer, which arrives as a 400", () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
        details: [{ reason: 'API_KEY_INVALID', domain: 'googleapis.com' }],
      },
    });
    expect(toModelCallError(apiError(400, body), live).failure).toBe('invalid-key');
  });

  it('treats a failure with no status, such as a network error, as unavailable', () => {
    expect(toModelCallError(apiError(undefined), live)).toMatchObject({
      failure: 'unavailable',
      statusCode: null,
    });
    expect(toModelCallError(new TypeError('fetch failed'), live).failure).toBe('unavailable');
    expect(toModelCallError('a string', live).failure).toBe('unavailable');
  });

  it('reports an aborted call as aborted, whatever was thrown', () => {
    const controller = new AbortController();
    controller.abort();
    expect(toModelCallError(apiError(500), controller.signal).failure).toBe('aborted');
  });

  it('looks through a retry wrapper to the last error', () => {
    const wrapped = new RetryError({
      message: 'failed after retries',
      reason: 'maxRetriesExceeded',
      errors: [apiError(503), apiError(429)],
    });
    expect(toModelCallError(wrapped, live).failure).toBe('rate-limited');
  });

  it('passes a ModelCallError through unchanged', () => {
    const original = new ModelCallError('rejected', 404);
    expect(toModelCallError(original, live)).toBe(original);
  });

  it('keeps nothing of the request or the provider message', () => {
    const mapped = toModelCallError(apiError(500, 'echo: sk-live-abcdef'), live);
    const serialised = JSON.stringify({ ...mapped, message: mapped.message });
    expect(serialised).not.toContain('SECRET PROJECT CODE');
    expect(serialised).not.toContain('sk-live-abcdef');
    expect(serialised).not.toContain('provider said no');
  });
});
