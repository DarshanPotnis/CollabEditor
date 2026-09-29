import { defineConfig } from 'vitest/config';

/**
 * The graders' self-test (npm run evals:selftest): every task's reference
 * session through the real harness and Docker sandbox, and every known-bad
 * one. Slower than the unit tests, so apart from them; CI runs it.
 */
export default defineConfig({
  test: {
    name: 'evals-selftest',
    environment: 'node',
    include: ['src/**/*.selftest.ts'],
    testTimeout: 300_000,
    hookTimeout: 600_000,
  },
});
