/**
 * How a response body is shown. It is always shown as text, never rendered
 * as HTML: the server is running code anyone in the project wrote.
 */
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
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
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

export type StatusTone = 'success' | 'redirect' | 'client-error' | 'server-error' | 'other';

export function statusTone(status: number): StatusTone {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'redirect';
  if (status >= 400 && status < 500) return 'client-error';
  if (status >= 500 && status < 600) return 'server-error';
  return 'other';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
