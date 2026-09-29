/**
 * How a response body is shown, in the API console and to the agent. It is
 * always shown as text, never rendered as HTML: the server is running code
 * anyone in the project wrote.
 */
import { web } from './web-globals.js';

export type FormattedBody =
  | { kind: 'empty' }
  | { kind: 'json'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'binary'; size: number; preview: string };

const PREVIEW_BYTES = 64;

function header(headers: ReadonlyArray<[string, string]>, name: string): string {
  return headers.find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
}

export function formatBody(
  body: Uint8Array,
  headers: ReadonlyArray<[string, string]>,
): FormattedBody {
  if (body.length === 0) return { kind: 'empty' };

  let text: string;
  try {
    text = new web.TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    // Not UTF-8: show it as bytes rather than as mojibake.
    const preview = [...body.subarray(0, PREVIEW_BYTES)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(' ');
    return { kind: 'binary', size: body.length, preview };
  }

  const looksJson = /\bjson\b/i.test(header(headers, 'content-type')) || /^\s*[[{]/.test(text);
  if (looksJson) {
    try {
      return { kind: 'json', text: JSON.stringify(JSON.parse(text), null, 2) };
    } catch {
      // Claimed or looked like JSON but is not; show exactly what came back.
      return { kind: 'text', text };
    }
  }
  return { kind: 'text', text };
}
