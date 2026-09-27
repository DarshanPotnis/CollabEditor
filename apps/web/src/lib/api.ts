/**
 * The REST client. Every response is validated against the shared schemas, so
 * a server change shows up here as a typed error rather than as undefined
 * deep inside a component.
 */
import { projectSummarySchema, type ProjectSummary, type TemplateId } from '@collabcode/shared';
import { ApiError, readApiError } from './api-error.js';
import { config } from './app-config.js';

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('network', 'Could not reach the server. Check your connection.');
  }

  if (!response.ok) throw await readApiError(response);

  try {
    return await response.json();
  } catch {
    throw new ApiError('malformed-response', 'The server sent something we could not read.');
  }
}

export async function createProject(input: {
  template: TemplateId;
  name?: string;
}): Promise<ProjectSummary> {
  const body = await requestJson('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const parsed = projectSummarySchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('malformed-response', 'The server sent a project we could not read.');
  }
  return parsed.data;
}

/** Returns null when there is no such project, which is not an error here. */
export async function fetchProject(id: string): Promise<ProjectSummary | null> {
  try {
    const body = await requestJson(`/api/projects/${encodeURIComponent(id)}`);
    const parsed = projectSummarySchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('malformed-response', 'The server sent a project we could not read.');
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not-found') return null;
    throw error;
  }
}

/**
 * Fire and forget: nudges a sleeping Render instance awake while the visitor
 * is still reading the landing page, so creating a project feels faster.
 */
export function pingHealth(): void {
  void fetch(`${config.apiUrl}/health`, { cache: 'no-store' }).catch(() => {
    // The ping is an optimisation; a failure is handled by the real request.
  });
}
