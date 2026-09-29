/**
 * Turning what someone typed into the API console into a request, with a
 * message they can act on for anything that would not work.
 */
import { type ApiRequest, type HttpMethod } from '@collabcode/agent';

export type RequestForm = {
  method: HttpMethod;
  path: string;
  headersText: string;
  body: string;
};

export type BuiltRequest = { ok: true; request: ApiRequest } | { ok: false; message: string };

/** The request travels as a command-line argument, so it is kept modest. */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const AUTOMATIC = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'keep-alive',
]);
const NO_BODY: ReadonlySet<HttpMethod> = new Set(['GET', 'HEAD']);

export function parseHeadersText(
  text: string,
): { ok: true; headers: Array<[string, string]> } | { ok: false; message: string } {
  const headers: Array<[string, string]> = [];
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    const name = colon === -1 ? line : line.slice(0, colon).trim();
    const where = `Header line ${String(index + 1)}`;
    if (colon === -1)
      return { ok: false, message: `${where} needs a colon, like "Accept: application/json".` };
    if (!TOKEN.test(name))
      return { ok: false, message: `${where}: "${name}" is not a valid header name.` };
    if (AUTOMATIC.has(name.toLowerCase())) {
      return { ok: false, message: `${where}: ${name} is set automatically; remove it.` };
    }
    headers.push([name, line.slice(colon + 1).trim()]);
  }
  return { ok: true, headers };
}

function contentTypeOf(headers: ReadonlyArray<[string, string]>): string | null {
  return headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? null;
}

function jsonProblem(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'it could not be parsed';
  }
}

export function buildRequest(form: RequestForm): BuiltRequest {
  const path = form.path.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    return {
      ok: false,
      message: 'Enter a path like /users. Requests always go to your running server.',
    };
  }
  if (!path.startsWith('/') || /\s/.test(path) || path.length > 2_048) {
    return {
      ok: false,
      message: 'The path must start with / and contain no spaces, like /users?limit=5.',
    };
  }

  const parsed = parseHeadersText(form.headersText);
  if (!parsed.ok) return parsed;
  const headers = parsed.headers;

  const body = form.body;
  if (body.trim() === '')
    return { ok: true, request: { method: form.method, path, headers, body: null } };
  if (NO_BODY.has(form.method)) {
    return {
      ok: false,
      message: `${form.method} requests can't have a body. Clear it, or use POST.`,
    };
  }
  if (new TextEncoder().encode(body).length > MAX_REQUEST_BODY_BYTES) {
    return { ok: false, message: 'The body is over 256 KB, the most the console can send.' };
  }

  const contentType = contentTypeOf(headers);
  const problem = jsonProblem(body);
  if (contentType === null) {
    headers.push([
      'Content-Type',
      problem === null ? 'application/json' : 'text/plain; charset=utf-8',
    ]);
  } else if (/\bjson\b/i.test(contentType) && problem !== null) {
    return { ok: false, message: `The body is not valid JSON: ${problem}` };
  }
  return { ok: true, request: { method: form.method, path, headers, body } };
}
