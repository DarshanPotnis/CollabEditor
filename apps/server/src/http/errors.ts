/**
 * One shape for every error the API returns, matching apiErrorSchema.
 */
import type { Response } from 'express';
import type { ApiErrorCode } from '@collabcode/shared';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  'bad-request': 400,
  forbidden: 403,
  'not-found': 404,
  'payload-too-large': 413,
  'rate-limited': 429,
  'quota-exhausted': 429,
  'invalid-key': 401,
  unavailable: 503,
  internal: 500,
};

export function sendApiError(res: Response, code: ApiErrorCode, message: string): void {
  res.status(STATUS_BY_CODE[code]).json({ error: { code, message } });
}
