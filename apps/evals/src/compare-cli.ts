/**
 * npm run evals:compare -- <run id> <run id> [...] [--out <file>]: recorded
 * runs side by side (results/compare.ts), the first being the one the others
 * are held against. Reads docs/evals/results/<run id>.json; prints the report,
 * or writes it to the file given.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { CompareError, compareRuns } from './results/compare.js';
import { RESULTS_DIR } from './results/readme.js';
import { runResultsSchema } from './results/run-results.js';

const USAGE = 'Usage: npm run evals:compare -- <run id> <run id> [...] [--out <file>]';

const argsSchema = z.object({
  runIds: z
    .array(
      z
        .string()
        .regex(/^[\w.-]+$/, 'A run id has only letters, digits, dots, dashes and underscores.'),
    )
    .min(2, USAGE),
  out: z.string().min(1).optional(),
});

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { out: { type: 'string' } },
    allowPositionals: true,
  });
  const args = argsSchema.parse({ runIds: positionals, out: values.out });
  const runs = [];
  for (const id of args.runIds) {
    runs.push(
      runResultsSchema.parse(JSON.parse(await readFile(join(RESULTS_DIR, `${id}.json`), 'utf8'))),
    );
  }
  const report = compareRuns(runs);
  if (args.out === undefined) {
    process.stdout.write(report);
    return;
  }
  // npm runs this in the workspace; INIT_CWD is where the command was typed.
  const target = resolve(process.env['INIT_CWD'] ?? process.cwd(), args.out);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, report);
  process.stdout.write(`Wrote ${args.out}.\n`);
}

main().catch((error: unknown) => {
  const message =
    error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(
    `${error instanceof CompareError || error instanceof z.ZodError ? '' : 'The comparison failed: '}${message}\n`,
  );
  process.exitCode = 1;
});
