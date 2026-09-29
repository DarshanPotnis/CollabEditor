/**
 * How the API console labels a response: its status as a tone, and its size.
 * The body itself is formatted by @collabcode/agent's formatBody, which the
 * agent's http_request uses too.
 */
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
