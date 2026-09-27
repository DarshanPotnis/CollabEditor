/**
 * Build-time configuration, validated once. A missing or malformed value is a
 * deploy mistake, so it fails loudly at start-up rather than at first use.
 */
import { z } from 'zod';

function isUrlWithScheme(schemes: string[]) {
  return (value: string): boolean => {
    try {
      return schemes.includes(new URL(value).protocol);
    } catch {
      return false;
    }
  };
}

const envSchema = z.object({
  VITE_API_URL: z
    .string()
    .refine(isUrlWithScheme(['http:', 'https:']), { message: 'must be an http(s) URL' }),
  VITE_COLLAB_URL: z
    .string()
    .refine(isUrlWithScheme(['ws:', 'wss:']), { message: 'must be a ws(s) URL' }),
});

export type WebConfig = {
  apiUrl: string;
  collabUrl: string;
};

export class WebConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebConfigError';
  }
}

export function loadWebConfig(env: unknown): WebConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${String(issue.path[0] ?? '(root)')}: ${issue.message}`)
      .join('; ');
    throw new WebConfigError(`Invalid frontend configuration — ${details}`);
  }
  return {
    // Trailing slashes would double up when we build request URLs.
    apiUrl: parsed.data.VITE_API_URL.replace(/\/+$/, ''),
    collabUrl: parsed.data.VITE_COLLAB_URL.replace(/\/+$/, ''),
  };
}
