/**
 * The headers that make the app cross-origin isolated, which WebContainers
 * need for SharedArrayBuffer (PLAN.md §10.1, ADR 006).
 *
 * One definition, used by the Vite dev and preview servers and checked
 * against vercel.json by a test, so development, e2e and production cannot
 * drift apart. It must stay free of browser APIs: vite.config.ts imports it.
 *
 * `require-corp` rather than `credentialless`: we load no cross-origin
 * resources without CORS, which is all credentialless would help with, and
 * Safari does not implement credentialless, so it would never be isolated.
 */
export const COEP = 'require-corp';

export const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': COEP,
} as const;
