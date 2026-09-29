/** The files that decide verdicts have not changed since GRADERS_VERSION was last considered. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GRADERS, GRADERS_FINGERPRINT } from './version.js';

const EVALS = fileURLToPath(new URL('../../', import.meta.url));

/** Graders, tasks and fixture projects; not tests, test helpers, the reference sessions or this version. */
const DECIDES_VERDICTS = [
  { dir: 'src/graders', keep: (name: string) => name.endsWith('.ts') },
  { dir: 'src/tasks', keep: (name: string) => name.endsWith('.ts') },
  { dir: 'fixtures/projects', keep: () => true },
];
const NOT_VERDICTS =
  /\.(test|selftest)\.ts$|made-up-sessions\.ts$|reference-session\.ts$|version\.ts$/;

function files(dir: string): string[] {
  return (
    readdirSync(dir, { withFileTypes: true, recursive: true })
      // macOS's folder files, which git ignores, would make this machine's hash differ from CI's.
      .filter((entry) => entry.isFile() && entry.name !== '.DS_Store')
      .map((entry) => join(entry.parentPath, entry.name))
  );
}

function fingerprint(): string {
  const hash = createHash('sha256');
  const paths = DECIDES_VERDICTS.flatMap(({ dir, keep }) =>
    files(join(EVALS, dir)).filter((path) => keep(path) && !NOT_VERDICTS.test(path)),
  ).sort();
  for (const path of paths) {
    hash.update(relative(EVALS, path)).update('\0').update(readFileSync(path)).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

describe('the graders version', () => {
  it('is reconsidered whenever the tasks, graders or fixture projects change', () => {
    expect(
      fingerprint(),
      `The tasks, graders or fixture projects changed since ${GRADERS}. If a verdict can change, bump GRADERS_VERSION in graders/version.ts and say what changed; either way, set GRADERS_FINGERPRINT to the value received.`,
    ).toBe(GRADERS_FINGERPRINT);
  });
});
