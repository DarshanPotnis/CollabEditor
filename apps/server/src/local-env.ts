/**
 * The rule for local commands (npm run dev, npm run migrate): values in
 * apps/server/.env take precedence over the environment.
 *
 * Node's --env-file never overrides a variable that is already set, so a
 * machine-wide variable, such as a DATABASE_URL a shell profile exports for
 * another project, would silently win over this project's .env. Production
 * does not use this: there the platform's environment is the configuration.
 */
import { parseEnv } from 'node:util';

/** Applies the file to `env` and returns the names of variables whose value it replaced. */
export function applyEnvFile(fileText: string, env: NodeJS.ProcessEnv): string[] {
  const values = parseEnv(fileText);
  const replaced = Object.keys(values).filter(
    (name) => env[name] !== undefined && env[name] !== values[name],
  );
  Object.assign(env, values);
  return replaced;
}
