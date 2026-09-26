/**
 * One shape for every error the API returns, matching apiErrorSchema.
 */
import type { Response } from 'express';
import type { ApiErrorCode } from '@collabcode/shared';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  'bad-request': 400,
  forbidden: 403,
  'not-found': 404,
  'rate-limited': 429,
  internal: 500,
};

export function sendApiError(res: Response, code: ApiErrorCode, message: string): void {
  res.status(STATUS_BY_CODE[code]).json({ error: { code, message } });
}
