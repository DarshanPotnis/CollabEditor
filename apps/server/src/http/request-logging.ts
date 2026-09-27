/**
 * Per-request logging. pino-http's default serializers log every request
 * header and every response header, and a caller's own AI key travels in a
 * header, so requests are logged from an allowlist instead: an id, the method
 * and the path. Nothing else about a request is worth the risk.
 */
import type { RequestHandler } from 'express';
import type { SerializedRequest, SerializedResponse } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../lib/logger.js';

export function requestLogging(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/health' },
    serializers: {
      req: (req: SerializedRequest) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res: SerializedResponse) => ({ statusCode: res.statusCode }),
    },
  });
}
