/**
 * The one logger. Nothing in the server writes to the console directly.
 */
import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

/** Used before the configuration has been parsed, so start-up failures are visible. */
export function createBootstrapLogger(): Logger {
  return pino({ level: 'info' });
}
