import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'evals',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The sandbox specs start Docker containers.
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});
