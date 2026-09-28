/**
 * Preloaded by the local scripts (`tsx --import ./src/load-local-env.ts`) so
 * that apps/server/.env wins over the environment (local-env.ts). It says
 * which variables it replaced, by name only: their values can be secrets.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createLogger } from './lib/logger.js';
import { applyEnvFile } from './local-env.js';

const envFile = new URL('../.env', import.meta.url);

if (existsSync(envFile)) {
  const replaced = applyEnvFile(readFileSync(envFile, 'utf8'), process.env);
  if (replaced.length > 0) {
    createLogger('info', true).info(
      { variables: replaced },
      'apps/server/.env takes precedence over these variables from your environment',
    );
  }
}
