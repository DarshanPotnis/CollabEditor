import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // The workspace packages are not published, so they are bundled into the output.
  noExternal: ['@collabcode/shared', '@collabcode/model-gateway'],
});
