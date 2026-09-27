/**
 * How API console requests go into the container and responses come back.
 *
 * The page runs a short helper process per request (request-script.ts) and
 * reads the result from **that process's own output**, never from the
 * terminal output the server writes to, so server logs cannot reach it.
 * The helper prints the whole response as one line:
 *
 *   <prefix><base64 of JSON>
 *
 * where the prefix carries a random nonce the page generated for this request.
 * Base64 has no newline or marker characters, so no response body can break
 * the framing; the nonce means nothing that did not receive it can print a
 * line the page will accept; a second line with the right prefix is treated
 * as tampering; and the decoded JSON is validated before use. The body
 * travels as bytes, so binary responses arrive intact.
 */
import { z } from 'zod';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type ApiRequest = {
  method: HttpMethod;
  /** A path on the running server, starting with `/`. */
  path: string;
  headers: Array<[string, string]>;
  body: string | null;
};

/** Responses larger than this are cut, and marked as truncated. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** How long the helper waits for the server before giving up. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Shared with the helper script, which cannot import. */
export const RESPONSE_PREFIX_START = 'COLLABCODE-RESPONSE-';

export function responsePrefix(nonce: string): string {
  return `${RESPONSE_PREFIX_START}${nonce}:`;
}

export function createNonce(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The request, as the single command-line argument the helper takes. */
export function encodeRequest(request: ApiRequest): string {
  return toBase64(JSON.stringify(request));
}

const MAX_HEADER_COUNT = 200;

const successSchema = z.object({
  ok: z.literal(true),
  status: z.number().int().min(0).max(999),
  statusText: z.string().max(1_000),
  headers: z.array(z.tuple([z.string().max(1_000), z.string().max(16_384)])).max(MAX_HEADER_COUNT),
  body: z.string().max(Math.ceil((MAX_BODY_BYTES * 4) / 3) + 8),
  size: z.number().int().nonnegative(),
  truncated: z.boolean(),
  ms: z.number().nonnegative(),
});

const failureSchema = z.object({
  ok: z.literal(false),
  error: z.string().max(2_000),
  ms: z.number().nonnegative(),
});

const helperResultSchema = z.discriminatedUnion('ok', [successSchema, failureSchema]);

export type ApiResponse = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: Uint8Array;
  /** The full size, which is more than `body.length` when truncated. */
  size: number;
  truncated: boolean;
  ms: number;
};

export type ApiResult =
  | { kind: 'response'; response: ApiResponse }
  /** The request was made but failed: refused, timed out, bad URL. */
  | { kind: 'request-failed'; message: string; ms: number }
  /** The helper's output could not be trusted or understood. */
  | { kind: 'invalid-output'; message: string };

const BASE64_LINE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Read the helper's output, accepting exactly one correctly prefixed line. */
export function parseHelperOutput(output: string, nonce: string): ApiResult {
  const prefix = responsePrefix(nonce);
  const candidates = output
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix));

  if (candidates.length === 0) {
    // Shown as plain text, never parsed: it helps explain a crash or a
    // missing Node feature without trusting any of it.
    const printed = output.replace(/\s+/g, ' ').trim().slice(0, 300);
    return {
      kind: 'invalid-output',
      message:
        printed === ''
          ? 'The request helper printed no response.'
          : `The request helper printed no response. It printed: ${printed}`,
    };
  }
  if (candidates.length > 1) {
    return {
      kind: 'invalid-output',
      message: 'The request helper printed more than one response, so neither is trusted.',
    };
  }

  const encoded = (candidates[0] ?? '').slice(prefix.length);
  if (!BASE64_LINE.test(encoded)) {
    return { kind: 'invalid-output', message: 'The response was not valid base64.' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64(encoded)));
  } catch {
    // Anything undecodable is exactly the case this function exists to reject.
    return { kind: 'invalid-output', message: 'The response could not be decoded.' };
  }

  const parsed = helperResultSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: 'invalid-output', message: 'The response did not have the expected shape.' };
  }
  const result = parsed.data;
  if (!result.ok) return { kind: 'request-failed', message: result.error, ms: result.ms };

  let body: Uint8Array;
  try {
    body = fromBase64(result.body);
  } catch {
    // As above: a malformed body is rejected, not guessed at.
    return { kind: 'invalid-output', message: 'The response body was not valid base64.' };
  }
  return {
    kind: 'response',
    response: {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body,
      size: result.size,
      truncated: result.truncated,
      ms: result.ms,
    },
  };
}
