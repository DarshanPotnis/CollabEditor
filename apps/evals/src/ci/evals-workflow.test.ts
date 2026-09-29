/**
 * The Evals workflow (.github/workflows/evals.yml) spends quota with a secret,
 * so how it can be started and where the secret goes are pinned here
 * (docs/decisions/010-evals.md): only by hand, never by a pull request, a push,
 * a schedule or a fork; read-only permissions; the secret in one step's
 * environment, which only writes it to a one-time file; and no workflow input
 * pasted into a script, where it could inject commands.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = new URL('../../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { if?: string; permissions?: Record<string, string>; steps: Step[] }>;
};

const workflow = parse(read('.github/workflows/evals.yml')) as Workflow;
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);

describe('the Evals workflow', () => {
  it('can only be started by hand, by someone with write access, in this repository', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    for (const job of Object.values(workflow.jobs)) {
      expect(job.if).toBe("github.repository == 'DarshanPotnis/CollabEditor'");
    }
  });

  it('reads the repository and nothing more, except a previous run to resume', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions).toEqual({ contents: 'read', actions: 'read' });
    }
  });

  it('puts the secret in one step, which only writes it to a file that only its user can read', () => {
    const withSecret = steps.filter((step) => JSON.stringify(step).includes('secrets.'));
    expect(withSecret).toHaveLength(1);
    const [handover] = withSecret;
    expect(Object.values(handover?.env ?? {})).toEqual(['${{ secrets.EVAL_GEMINI_API_KEY }}']);
    expect(handover?.run).toContain('umask 077');
    expect(handover?.run).toContain('> "$RUNNER_TEMP/eval-key"');
    expect(handover?.run).not.toContain('secrets.');
    // The run gets the file, never the variable, and the file is removed whatever happens.
    const run = steps.find((step) => step.run?.includes('npm run evals'));
    expect(run?.run).toContain('--key-file "$RUNNER_TEMP/eval-key"');
    expect(JSON.stringify(run?.env ?? {})).not.toMatch(/secret|KEY/i);
    expect(
      steps.some(
        (step) => step.if === '${{ always() }}' && step.run === 'rm -f "$RUNNER_TEMP/eval-key"',
      ),
    ).toBe(true);
  });

  it('never pastes an input or event text into a script', () => {
    for (const step of steps) {
      expect(step.run ?? '', step.name).not.toMatch(/\$\{\{\s*(inputs|github\.event)\./);
    }
  });

  it('keeps the push and pull-request workflow free of secrets', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('secrets.');
  });
});
