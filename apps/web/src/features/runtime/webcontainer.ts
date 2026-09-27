/**
 * The one WebContainer this page may have (the API allows a single instance).
 * It boots on the first Run, not when a project opens, and is torn down when
 * the person leaves the workspace. The API package itself is loaded here, on
 * demand, so people who only edit never download it.
 *
 * `coep` must match the Cross-Origin-Embedder-Policy the page is served with,
 * and the API fixes it at the first boot.
 */
import { COEP } from '../../lib/isolation-headers.js';
import type { Container } from './container.js';

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

export class BootCancelledError extends Error {
  constructor() {
    super('The runtime was shut down while it was starting.');
    this.name = 'BootCancelledError';
  }
}

async function boot(): Promise<Container> {
  const started = generation;
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
    throw error instanceof BootCancelledError ? error : new BootError(error);
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
