/**
 * The version of what judges a run: the tasks, their hidden checks and the
 * graders. Every run's results record it, and two runs compare fairly only
 * when it is the same (docs/evals/README.md). Bump it for any change that can
 * change a verdict, and say here what changed:
 *
 * 1. The first graders (AI-4).
 * 2. says-untested accepts "the sandbox wasn't available"; claimed-checks
 *    joins every task (a summary names only checks the session made).
 *
 * The fingerprint is a hash of the files that decide verdicts, which
 * version.test.ts recomputes, so that none of them changes unnoticed.
 */
export const GRADERS_VERSION = 2;
export const GRADERS = `graders@${String(GRADERS_VERSION)}`;
export const GRADERS_FINGERPRINT = '0c366be71fbee484';
