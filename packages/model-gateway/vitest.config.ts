import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'model-gateway',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
