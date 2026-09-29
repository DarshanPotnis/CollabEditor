/**
 * The evals' model key, and where it may be (docs/decisions/010-evals.md).
 *
 * It lives in this process's memory and nowhere else it can be read from:
 *
 * - never in this process's environment. /proc/<pid>/environ shows a
 *   process's environment as it was started, to any process of the same
 *   user, and deleting the variable later does not change it. So the runner
 *   refuses to start when a key is in its environment at all;
 * - in CI, the workflow writes the secret to a file in a separate step, and
 *   the runner reads it and deletes the file before anything else runs;
 * - locally, it is read from apps/evals/.env, which git ignores.
 *
 * Children (the docker CLI) get an allowlisted environment
 * (sandbox/docker.ts), and model-written code runs in a container that has
 * neither this process's environment nor its files.
 *
 * The key is held in a Secret, which prints as "[secret]" wherever it could
 * end up in a log, a result or a trace; only the model client reveals it.
 */
import { readFile, unlink } from 'node:fs/promises';
import { inspect } from 'node:util';

export const EVAL_KEY_VARIABLE = 'EVAL_GEMINI_API_KEY';

/** Names a Gemini key goes by. The Google provider reads the last one by itself when not given a key. */
const KEY_VARIABLES = [EVAL_KEY_VARIABLE, 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'];

const REDACTED = '[secret]';

export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** For the one place that sends it to the provider. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

export class EvalKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalKeyError';
  }
}

export type KeySource =
  /** CI: a file the workflow wrote for this run, deleted as soon as it is read. */
  | { kind: 'one-time-file'; path: string }
  /** Locally: apps/evals/.env, which stays. */
  | { kind: 'env-file'; path: string };

/** Refuses to go on with a key in the environment, where same-user processes can read it. */
export function refuseKeyInEnvironment(env: Readonly<Record<string, string | undefined>>): void {
  const found = KEY_VARIABLES.filter((name) => (env[name] ?? '') !== '');
  if (found.length > 0) {
    throw new EvalKeyError(
      `${found.join(' and ')} ${found.length === 1 ? 'is' : 'are'} set in this process's environment, where other processes of yours can read it (/proc/<pid>/environ). Unset it, and put the key in apps/evals/.env (locally) or pass it with --key-file (CI).`,
    );
  }
}

function keyFromEnvFile(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*EVAL_GEMINI_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
    if (match) return (match[1] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}

export async function loadEvalKey(
  source: KeySource,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Secret> {
  refuseKeyInEnvironment(env);
  let text: string;
  try {
    text = await readFile(source.path, 'utf8');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
    throw new EvalKeyError(`The key file ${source.path} could not be read (${code}).`);
  }
  if (source.kind === 'one-time-file') await unlink(source.path);
  const value = source.kind === 'one-time-file' ? text.trim() : keyFromEnvFile(text);
  if (value === '') {
    throw new EvalKeyError(
      source.kind === 'one-time-file'
        ? `The key file ${source.path} is empty.`
        : `${source.path} has no ${EVAL_KEY_VARIABLE}= line with a value.`,
    );
  }
  return new Secret(value);
}
