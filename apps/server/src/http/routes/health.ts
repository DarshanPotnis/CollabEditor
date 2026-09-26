import { Router } from 'express';
import type { HealthResponse } from '@collabcode/shared';

/**
 * Deliberately trivial: this is what the web app pings to wake Render from a
 * cold start, so it must answer as soon as the process is up and must never
 * touch the database.
 */
export function createHealthRouter(startedAt: number): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const body: HealthResponse = {
      ok: true,
      uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
    };
    res.json(body);
  });

  return router;
}
