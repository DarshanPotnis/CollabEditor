/**
 * What Run does, read from the project's package.json (PLAN.md §10.2).
 *
 * package.json is written by collaborators, so it is parsed defensively and
 * every problem becomes a sentence the person can act on. The scripts
 * themselves are arbitrary commands; they run inside the container.
 */
import { z } from 'zod';

export type RunScript = 'dev' | 'start';

export type RunPlan =
  | { kind: 'ready'; script: RunScript; args: string[]; installKey: string }
  | { kind: 'problem'; message: string };

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
] as const;

const packageJsonSchema = z.looseObject({
  scripts: z.record(z.string(), z.string()).optional(),
});

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

/**
 * What `npm install` depends on: the dependency sections only, in a stable
 * order, so editing a script or reformatting the file does not reinstall.
 * An empty string means there is nothing to install.
 */
export function installKey(pkg: Record<string, unknown>): string {
  const relevant = Object.fromEntries(
    DEPENDENCY_FIELDS.filter((field) => pkg[field] !== undefined).map((field) => [
      field,
      pkg[field],
    ]),
  );
  return Object.keys(relevant).length === 0 ? '' : JSON.stringify(sortKeys(relevant));
}

export function runPlan(packageJson: string | undefined): RunPlan {
  if (packageJson === undefined) {
    return {
      kind: 'problem',
      message:
        'There is no package.json at the project root. Add one with a "dev" or "start" script.',
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(packageJson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'it could not be parsed';
    return { kind: 'problem', message: `package.json is not valid JSON: ${reason}` };
  }

  const parsed = packageJsonSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: 'problem',
      message: 'package.json must be an object, and its "scripts" must map names to commands.',
    };
  }

  const scripts = parsed.data.scripts ?? {};
  const key = installKey(parsed.data);
  if (scripts['dev'] !== undefined)
    return { kind: 'ready', script: 'dev', args: ['run', 'dev'], installKey: key };
  if (scripts['start'] !== undefined)
    return { kind: 'ready', script: 'start', args: ['start'], installKey: key };
  return {
    kind: 'problem',
    message:
      'package.json has no "dev" or "start" script. For example: "dev": "node --watch index.js".',
  };
}

/** Whether `npm install` has to run before starting. */
export function needsInstall(key: string, installedKey: string | null): boolean {
  return key !== '' && key !== installedKey;
}
