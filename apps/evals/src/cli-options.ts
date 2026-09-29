/**
 * The eval command's options (npm run evals -- --help), validated like any
 * other input, and the rule for where a real-model run may happen: in CI by
 * default, where the runner is thrown away afterwards; on this machine only
 * when asked for explicitly, with a warning.
 */
import { parseArgs } from 'node:util';
import type { AgentTier } from '@collabcode/shared';
import { z } from 'zod';
import { COMPARISON_TASKS, TASKS } from './tasks/index.js';
import type { TaskDefinition } from './tasks/task.js';

export const HELP = `Usage: npm run evals -- [options]

Runs the eval tasks against a real model (docs/evals/README.md).

  --model <id>              the model (default gemini-3.5-flash-lite)
  --tasks <which>           all (default), comparison, or task ids separated by commas
  --trials <n>              sessions per task (default 1)
  --tier <shared|ownKey>    the step limit to run under (default shared: 15 steps)
  --key-file <path>         the key, in a file that is deleted once read (CI)
  --allow-local-real-run    run on this machine instead of in CI
  --rpm <n>, --rpd <n>      the eval project's limits, if not the recorded ones
  --resume <run id>         carry on a run that stopped early
  --help                    this text

Locally the key is read from apps/evals/.env (EVAL_GEMINI_API_KEY=...), never from the
environment.`;

const TIERS = ['shared', 'ownKey'] as const satisfies readonly AgentTier[];
const positive = z.coerce.number().int().positive();

const optionsSchema = z.object({
  model: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,80}$/, 'The model id looks wrong.')
    .default('gemini-3.5-flash-lite'),
  tasks: z.string().default('all'),
  trials: positive.max(10).default(1),
  tier: z.enum(TIERS).default('shared'),
  keyFile: z.string().min(1).optional(),
  allowLocalRealRun: z.boolean().default(false),
  rpm: positive.optional(),
  rpd: positive.optional(),
  resume: z
    .string()
    .regex(/^[\w.-]{1,120}$/, 'The run id looks wrong.')
    .optional(),
  help: z.boolean().default(false),
});
export type CliOptions = z.infer<typeof optionsSchema>;

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  let values: Record<string, unknown>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        model: { type: 'string' },
        tasks: { type: 'string' },
        trials: { type: 'string' },
        tier: { type: 'string' },
        'key-file': { type: 'string' },
        'allow-local-real-run': { type: 'boolean' },
        rpm: { type: 'string' },
        rpd: { type: 'string' },
        resume: { type: 'string' },
        help: { type: 'boolean' },
      },
      strict: true,
    }));
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
  const parsed = optionsSchema.safeParse({
    model: values['model'],
    tasks: values['tasks'],
    trials: values['trials'],
    tier: values['tier'],
    keyFile: values['key-file'],
    allowLocalRealRun: values['allow-local-real-run'],
    rpm: values['rpm'],
    rpd: values['rpd'],
    resume: values['resume'],
    help: values['help'],
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CliError(`--${String(issue?.path[0] ?? '')}: ${issue?.message ?? 'invalid'}`);
  }
  return parsed.data;
}

export function selectTasks(which: string): readonly TaskDefinition[] {
  if (which === 'all') return TASKS;
  if (which === 'comparison') return COMPARISON_TASKS;
  const ids = which
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  const unknown = ids.filter((id) => !TASKS.some((task) => task.id === id));
  if (ids.length === 0 || unknown.length > 0) {
    throw new CliError(
      `Unknown task${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ') || '(none given)'}. Known: ${TASKS.map((task) => task.id).join(', ')}.`,
    );
  }
  return TASKS.filter((task) => ids.includes(task.id));
}

export const LOCAL_RUN_WARNING =
  'Running a real-model eval on this machine. Model-written code runs in the Docker sandbox (no network, no key, only its project directory writable), but the default is CI, whose runners are thrown away afterwards.';

export type Gate = { local: boolean; warning: string | null };

/** Where this run may happen, or why it may not. */
export function realRunGate(
  options: CliOptions,
  env: Readonly<Record<string, string | undefined>>,
): Gate {
  const inCi = env['GITHUB_ACTIONS'] === 'true';
  if (inCi) {
    if (options.keyFile === undefined) {
      throw new CliError(
        'In CI the key comes from --key-file, written by an earlier step and deleted once read.',
      );
    }
    return { local: false, warning: null };
  }
  if (!options.allowLocalRealRun) {
    throw new CliError(
      'Real-model evals run in CI by default (the Evals workflow, started by hand). To run one on this machine, add --allow-local-real-run.',
    );
  }
  return { local: true, warning: LOCAL_RUN_WARNING };
}
