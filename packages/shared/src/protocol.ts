/**
 * HTTP API contract, shared by the server (which validates requests against
 * it) and the client (which validates responses against it).
 */
import { z } from 'zod';
import { MAX_PROJECT_NAME_LENGTH } from './limits.js';
import { TEMPLATE_IDS } from './templates/index.js';

/** Project IDs come from `createProjectId`, and name the Hocuspocus document. */
export const projectIdSchema = z.string().regex(/^[a-z0-9]{6,32}$/);

export const templateIdSchema = z.enum(TEMPLATE_IDS);

export const createProjectBodySchema = z.object({
  name: z
    .string()
    .max(4096)
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(MAX_PROJECT_NAME_LENGTH))
    .optional(),
  template: templateIdSchema,
});
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const projectSummarySchema = z.object({
  id: projectIdSchema,
  name: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH),
  template: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const API_ERROR_CODES = ['bad-request', 'not-found', 'rate-limited', 'internal'] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string().min(1),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** The WebSocket path Hocuspocus listens on. */
export const COLLAB_PATH = '/collab';
