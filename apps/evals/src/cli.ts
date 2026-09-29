/**
 * npm run evals: a real-model eval run (docs/evals/README.md).
 *
 *   1. where it may run (CI by default) and with which tasks;
 *   2. the key, into memory: from a one-time file in CI, apps/evals/.env
 *      locally, and never while a key is in this process's environment;
 *   3. the sandbox image, the eval project's limits, the request ledger;
 *   4. the tasks, each session graded as it ends, stopping before a session
 *      the day's remaining requests could not pay for;
 *   5. the results: docs/evals/results/<run id>.json and .md once the run is
 *      complete, and the traces in apps/evals/runs/<run id>.
 *
 * A failing task is a result, not an error: the command fails only when it
 * cannot run.
 */
import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createAiSdkGateway } from '@collabcode/model-gateway';
import { AGENT_STEP_LIMITS, PROMPTS } from '@collabcode/shared';
import { CliError, HELP, parseCliOptions, realRunGate, selectTasks } from './cli-options.js';
import { nodeClock } from './harness/node-clock.js';
import { RESULTS_FILE, runSuite } from './harness/run-suite.js';
import { createGatewayModelClient } from './model/gateway-model-client.js';
import { limitsFor } from './model/model-limits.js';
import { createPacer } from './model/pacer.js';
import { RequestLedger, pacificDay } from './model/request-ledger.js';
import { RESULTS_DIR } from './results/readme.js';
import { reportMarkdown } from './results/report.js';
import { runResultsSchema, type RunResults } from './results/run-results.js';
import { bakedDependencies, ensureSandboxImage } from './sandbox/image.js';
import { dockerEnv } from './sandbox/docker.js';
import { EvalKeyError, loadEvalKey } from './secrets/eval-key.js';

const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const RUNS_DIR = fileURLToPath(new URL('../runs/', import.meta.url));
/** Retries a session may add to its steps, in the budget it needs before it starts. */
const RETRY_ALLOWANCE = 5;

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

async function commit(): Promise<string> {
  const { stdout } = await promisify(execFile)('git', ['rev-parse', '--short', 'HEAD'], {
    env: dockerEnv(),
  });
  return stdout.trim();
}

async function resumed(runId: string): Promise<RunResults> {
  const raw: unknown = JSON.parse(await readFile(join(RUNS_DIR, runId, RESULTS_FILE), 'utf8'));
  return runResultsSchema.parse(raw);
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.help) {
    out(HELP);
    return;
  }
  const gate = realRunGate(options, process.env);
  if (gate.warning !== null) process.stderr.write(`Warning: ${gate.warning}\n`);
  const tasks = selectTasks(options.tasks);

  const key = await loadEvalKey(
    options.keyFile === undefined
      ? { kind: 'env-file', path: ENV_FILE }
      : { kind: 'one-time-file', path: options.keyFile },
  );
  const image = await ensureSandboxImage();
  const baked = await bakedDependencies();
  const limits = limitsFor(options.model, {
    ...(options.rpm === undefined ? {} : { rpm: options.rpm }),
    ...(options.rpd === undefined ? {} : { rpd: options.rpd }),
  });
  const ledger = await RequestLedger.open();
  const gateway = createAiSdkGateway({
    // Warnings only: the SDK's, which name no prompt, answer or key.
    logger: {
      warn: (details, message) =>
        process.stderr.write(`${JSON.stringify({ message, ...details })}\n`),
    },
  });
  const modelClient = createGatewayModelClient({
    gateway,
    provider: 'gemini',
    model: options.model,
    key,
    tier: options.tier,
    pacer: createPacer(limits.rpm, nodeClock),
    ledger,
    dailyLimit: limits.rpd,
  });

  const sha = await commit();
  const runId = options.resume ?? `${pacificDay(nodeClock.now())}-${options.model}-${sha}`;
  const sessionBudget = AGENT_STEP_LIMITS[options.tier] + RETRY_ALLOWANCE;
  out(
    `Eval run ${runId}: ${String(tasks.length)} task${tasks.length === 1 ? '' : 's'} × ${String(options.trials)} on ${options.model} (${String(limits.rpm)} a minute, ${String(limits.rpd)} a day; ${String(ledger.used(options.model))} used today).`,
  );

  const results = await runSuite({
    tasks,
    trials: options.trials,
    runId,
    model: { provider: 'gemini', id: options.model },
    modelClient,
    prompt: `${PROMPTS.agent.id}@${String(PROMPTS.agent.version)}`,
    tier: options.tier,
    image,
    baked,
    clock: nodeClock,
    commit: sha,
    local: gate.local,
    runDir: join(RUNS_DIR, runId),
    resume: options.resume === undefined ? null : await resumed(options.resume),
    mayStart: () => {
      const used = ledger.used(options.model);
      return limits.rpd - used >= sessionBudget
        ? null
        : `${String(used)} of the day's ${String(limits.rpd)} requests are used, and a session can take up to ${String(sessionBudget)}. Resume tomorrow (Pacific time) with --resume ${runId}.`;
    },
    log: out,
  });

  const report = reportMarkdown(results);
  if (results.run.finishedAt !== null) {
    await mkdir(RESULTS_DIR, { recursive: true });
    await writeFile(join(RESULTS_DIR, `${runId}.json`), `${JSON.stringify(results, null, 2)}\n`);
    await writeFile(join(RESULTS_DIR, `${runId}.md`), report);
    out(`\nRecorded in docs/evals/results/${runId}.json and .md.`);
  } else {
    out(`\nNot finished; the results so far are in apps/evals/runs/${runId}.`);
  }
  const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryFile !== undefined) await appendFile(summaryFile, report);
  out(`\n${report}`);
}

main().catch((error: unknown) => {
  const known = error instanceof CliError || error instanceof EvalKeyError;
  process.stderr.write(
    `${known ? '' : 'The eval run failed: '}${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
