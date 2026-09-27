import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests start a real server and wait for debounced stores.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
