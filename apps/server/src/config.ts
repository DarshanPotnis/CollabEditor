/**
 * Environment validation. Every variable the server reads is declared here and
 * parsed once at start-up, so a misconfigured deploy fails immediately with a
 * readable message instead of at the first request.
 */
import { z } from 'zod';
import { CLIENT_IP_SOURCES } from './http/client-ip.js';

const originSchema = z.string().refine(
  (value) => {
    try {
      return new URL(value).origin === value;
    } catch {
      return false;
    }
  },
  { message: 'must be an origin such as https://app.example.com (no path, no trailing slash)' },
);

/** A whole number from the environment, where an empty value means "use the default". */
function envCount(fallback: number) {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().nonnegative().max(1_000_000).default(fallback),
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(8080),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: 'must be a postgres:// or postgresql:// connection string',
    }),
  /** Comma-separated list of web origins allowed to call the API. */
  ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .pipe(z.array(originSchema)),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * Where a request's client IP comes from, for per-IP limits: `render` trusts
   * the first X-Forwarded-For entry (Render sets it), `direct` uses the socket.
   * See http/client-ip.ts.
   */
  CLIENT_IP_SOURCE: z.enum(CLIENT_IP_SOURCES).default('render'),
  /**
   * Key for the shared free tier (Google AI Studio). Optional: without it the
   * shared tier is off and callers can still use their own key. Never logged.
   */
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed === undefined || trimmed === '' ? undefined : trimmed;
    }),
  /** The Gemini model the shared tier calls. */
  AI_DEFAULT_MODEL: z
    .string()
    .regex(/^gemini-[a-z0-9.-]{1,60}$/, { message: 'must be a Gemini model id' })
    .default('gemini-3.5-flash-lite'),
  /** Shared-tier requests per day for everyone together: 80% of the free quota. */
  AI_GLOBAL_DAILY_REQUESTS: envCount(400),
  /** Shared-tier requests per day from one visitor (client IP, IPv6 by /56). */
  AI_PER_IP_DAILY_REQUESTS: envCount(30),
  /** Shared-tier requests per day for one project. */
  AI_PER_PROJECT_DAILY_REQUESTS: envCount(60),
  /**
   * Shared-tier requests everyone together may start in any 60 seconds: about
   * 80% of the free tier's 15 requests a minute.
   */
  AI_GLOBAL_REQUESTS_PER_MINUTE: envCount(12),
  /**
   * How many of those may be AI agent steps, so the one-shot helpers keep the
   * rest. Also keeps a busy agent under the free tier's tokens per minute.
   */
  AI_AGENT_REQUESTS_PER_MINUTE: envCount(6),
});

export type ServerConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
