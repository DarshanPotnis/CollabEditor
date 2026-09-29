/** The commit this checkout is at, short: what a run records it ran, or was graded, with. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dockerEnv } from '../sandbox/docker.js';

export async function currentCommit(): Promise<string> {
  // The allowlisted environment: nothing of this process's own reaches git.
  const { stdout } = await promisify(execFile)('git', ['rev-parse', '--short', 'HEAD'], {
    env: dockerEnv(),
  });
  return stdout.trim();
}
