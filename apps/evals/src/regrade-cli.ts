/**
 * npm run evals:regrade -- <run id>: grades a recorded run again with today's
 * graders, from its saved traces (results/regrade.ts). Reads
 * docs/evals/results/<run id>.json and the traces in apps/evals/runs/<run id>
 * (a CI run's eval-run artifact holds both), and rewrites the results and
 * their report. No model is asked and nothing runs.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseTrace, type AgentTrace } from '@collabcode/agent';
import { z } from 'zod';
import { currentCommit } from './harness/git-commit.js';
import { RUNS_DIR } from './harness/run-suite.js';
import { RESULTS_DIR } from './results/readme.js';
import { RegradeError, regrade } from './results/regrade.js';
import { reportMarkdown } from './results/report.js';
import { runResultsSchema } from './results/run-results.js';
import { TASKS } from './tasks/index.js';

const runIdSchema = z
  .string({ error: 'Usage: npm run evals:regrade -- <run id>' })
  .regex(/^[\w.-]+$/, 'A run id has only letters, digits, dots, dashes and underscores.');

async function savedTraces(
  runId: string,
  files: readonly string[],
): Promise<Map<string, AgentTrace>> {
  const traces = new Map<string, AgentTrace>();
  for (const file of files) {
    if (file !== basename(file)) throw new RegradeError(`${file} is not a trace file's name.`);
    const path = join(RUNS_DIR, runId, file);
    const trace = parseTrace(JSON.parse(await readFile(path, 'utf8')) as unknown);
    if (!trace) throw new RegradeError(`${path} is not a trace.`);
    traces.set(file, trace);
  }
  return traces;
}

async function main(): Promise<void> {
  const runId = runIdSchema.parse(process.argv[2]);
  const resultsPath = join(RESULTS_DIR, `${runId}.json`);
  const recorded = runResultsSchema.parse(JSON.parse(await readFile(resultsPath, 'utf8')));
  const traces = await savedTraces(
    runId,
    recorded.results.map((result) => result.trace),
  );
  const graded = regrade({
    results: recorded,
    tasks: TASKS,
    trace: (file) => {
      const trace = traces.get(file);
      if (!trace) throw new RegradeError(`No trace ${file} for run ${runId}.`);
      return trace;
    },
    commit: await currentCommit(),
    now: new Date(),
  });
  await writeFile(resultsPath, `${JSON.stringify(graded, null, 2)}\n`);
  await writeFile(join(RESULTS_DIR, `${runId}.md`), reportMarkdown(graded));
  const changed = graded.run.regraded?.changes.length ?? 0;
  process.stdout.write(
    `Graded ${runId} again with ${graded.run.graders} (it had ${recorded.run.graders}): ${String(changed)} verdict${changed === 1 ? '' : 's'} changed. Rewrote docs/evals/results/${runId}.json and .md.\n`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(
    `${error instanceof RegradeError || error instanceof z.ZodError ? '' : 'The re-grade failed: '}${message}\n`,
  );
  process.exitCode = 1;
});
