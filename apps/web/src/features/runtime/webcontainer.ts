/**
 * The one WebContainer this page may have (the API allows a single instance).
 * It boots on the first Run, not when a project opens, and is torn down when
 * the person leaves the workspace. The API package itself is loaded here, on
 * demand, so people who only edit never download it.
 *
 * `coep` must match the Cross-Origin-Embedder-Policy the page is served with,
 * and the API fixes it at the first boot.
 *
 * Every boot, whoever asks for it (Run, the Shell, the API tab, the AI
 * teammate), first checks that the page is cross-origin isolated, and says why
 * not instead of booting into an error about SharedArrayBuffer. Only a boot
 * that fails on an isolated page gets the third-party cookie hint.
 */
import { COEP } from '../../lib/isolation-headers.js';
import type { Container } from './container.js';
import { isolationProblem, pageIsolation } from './runtime-support.js';

let booting: Promise<Container> | null = null;
let teardown: (() => void) | null = null;
/** Bumped by every teardown, so a boot that finishes afterwards is discarded. */
let generation = 0;

export class BootError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `The runtime could not start (${detail}). If your browser blocks third-party cookies, allow them for stackblitz.com and try again.`,
    );
    this.name = 'BootError';
  }
}

/** The page is not cross-origin isolated, so there was nothing to boot. */
export class NotIsolatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotIsolatedError';
  }
}

export class BootCancelledError extends Error {
  constructor() {
    super('The runtime was shut down while it was starting.');
    this.name = 'BootCancelledError';
  }
}

async function boot(): Promise<Container> {
  const started = generation;
  const problem = isolationProblem(pageIsolation());
  if (problem !== null) throw new NotIsolatedError(problem);
  const { WebContainer } = await import('@webcontainer/api');
  const container = await WebContainer.boot({ coep: COEP, workdirName: 'project' });
  if (started !== generation) {
    container.teardown();
    throw new BootCancelledError();
  }
  teardown = () => container.teardown();
  return {
    fs: container.fs,
    spawn: (command, args, options) => container.spawn(command, args, options),
    onPort: (listener) => container.on('port', listener),
  };
}

export function bootContainer(): Promise<Container> {
  booting ??= boot().catch((error: unknown) => {
    booting = null;
    throw error instanceof BootCancelledError || error instanceof NotIsolatedError
      ? error
      : new BootError(error);
  });
  return booting;
}

/** Tear down the container if one was booted. Safe to call at any time. */
export function teardownContainer(): void {
  generation += 1;
  teardown?.();
  teardown = null;
  booting = null;
}
