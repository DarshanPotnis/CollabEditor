/**
 * The one logger. Nothing in the server writes to the console directly.
 *
 * Request logs already leave headers out (http/request-logging.ts). Redaction
 * is a second layer, for any other code path that logs a request, its headers
 * or a model target: keys must never reach the logs, whatever logs them.
 */
import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-ai-key"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-ai-key"]',
  'apiKey',
  '*.apiKey',
  '*.*.apiKey',
  'GEMINI_API_KEY',
  '*.GEMINI_API_KEY',
];

export function createLogger(
  level: string,
  pretty: boolean,
  destination?: DestinationStream,
): Logger {
  const options = { level, redact: { paths: REDACTED_PATHS, censor: '[redacted]' } };
  if (pretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }
  return destination ? pino(options, destination) : pino(options);
}

/** Used before the configuration has been parsed, so start-up failures are visible. */
export function createBootstrapLogger(): Logger {
  return pino({ level: 'info' });
}
