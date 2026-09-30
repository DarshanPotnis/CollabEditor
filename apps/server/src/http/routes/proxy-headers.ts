/**
 * TEMPORARY diagnostic endpoint (removed by the client-IP fix): the shape of
 * the caller's own client-address headers, with no address in it. See
 * ../proxy-headers.ts.
 */
import { Router } from 'express';
import { describeProxyHeaders } from '../proxy-headers.js';

export function createProxyHeadersRouter(): Router {
  const router = Router();
  router.get('/debug/proxy-headers', (req, res) => {
    res.set('cache-control', 'no-store').json(describeProxyHeaders(req));
  });
  return router;
}
