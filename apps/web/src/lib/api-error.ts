/**
 * The error every API call throws, and reading one from a failed response.
 * Kept apart from api.ts, which reads the app's configuration when imported,
 * so modules that call the API can be tested without a configured build.
 */
import { apiErrorSchema, type ApiErrorCode } from '@collabcode/shared';

export type ApiFailureCode = ApiErrorCode | 'network' | 'malformed-response';

export class ApiError extends Error {
  readonly code: ApiFailureCode;

  constructor(code: ApiFailureCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/** The server's own error when the body carries one, else one naming the status. */
export async function readApiError(response: Response): Promise<ApiError> {
  try {
    const parsed = apiErrorSchema.safeParse(await response.json());
    if (parsed.success) return new ApiError(parsed.data.error.code, parsed.data.error.message);
  } catch {
    // Fall through to the generic message below.
  }
  return new ApiError('internal', `The server answered with ${String(response.status)}.`);
}
