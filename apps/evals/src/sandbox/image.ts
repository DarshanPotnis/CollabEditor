/**
 * The sandbox image (apps/evals/docker): tagged with a hash of what it is
 * built from, so a changed Dockerfile or dependency list builds a new image
 * and an unchanged one is reused. Building needs the network (to pull the
 * base image and the fixture dependencies); running it never has any.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { docker } from './docker.js';

const DOCKER_DIR = fileURLToPath(new URL('../../docker/', import.meta.url));
const BUILT_FROM = ['Dockerfile', 'deps/package.json', 'deps/package-lock.json'];
const BUILD_TIMEOUT_MS = 10 * 60_000;

const depsSchema = z.object({ dependencies: z.record(z.string(), z.string()) });

/** The packages installed in the image, which a fixture may use; nothing else can be installed. */
export async function bakedDependencies(): Promise<ReadonlySet<string>> {
  const raw: unknown = JSON.parse(await readFile(`${DOCKER_DIR}deps/package.json`, 'utf8'));
  return new Set(Object.keys(depsSchema.parse(raw).dependencies));
}

export async function sandboxImageTag(): Promise<string> {
  const hash = createHash('sha256');
  for (const file of BUILT_FROM) hash.update(await readFile(`${DOCKER_DIR}${file}`));
  return `collabcode-eval-sandbox:${hash.digest('hex').slice(0, 16)}`;
}

/** The image's tag, built first if this machine does not have it yet. */
export async function ensureSandboxImage(): Promise<string> {
  const tag = await sandboxImageTag();
  const present = await docker(['image', 'inspect', tag], { timeoutMs: 30_000 });
  if (present.code === 0) return tag;
  const built = await docker(['build', '--tag', tag, DOCKER_DIR], { timeoutMs: BUILD_TIMEOUT_MS });
  if (built.code !== 0) {
    throw new Error(`Building the sandbox image failed:\n${built.stderr.slice(-4_000)}`);
  }
  return tag;
}
