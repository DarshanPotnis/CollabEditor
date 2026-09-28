/**
 * Helpers for the AI route's integration tests: send a step the way the
 * browser does, and read back its events or its error.
 */
import {
  AI_KEY_HEADER,
  AI_STEP_PATH,
  aiStreamEventSchema,
  apiErrorSchema,
  type AiStreamEvent,
} from '@collabcode/shared';
import { expect } from 'vitest';
import type { TestServer } from '../collab/test-server.js';

export const ORIGIN = 'http://localhost:5173';

export function step(
  server: TestServer,
  body: unknown,
  options: { key?: string; origin?: string | null; signal?: AbortSignal } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.origin !== null) headers['origin'] = options.origin ?? ORIGIN;
  if (options.key !== undefined) headers[AI_KEY_HEADER] = options.key;
  return fetch(`${server.httpUrl}${AI_STEP_PATH}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function events(response: Response): Promise<AiStreamEvent[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((chunk) => chunk !== '')
    .map((chunk) => {
      expect(chunk.startsWith('data: ')).toBe(true);
      return aiStreamEventSchema.parse(JSON.parse(chunk.slice('data: '.length)));
    });
}

export async function apiError(response: Response): Promise<{ code: string; message: string }> {
  return apiErrorSchema.parse(await response.json()).error;
}
