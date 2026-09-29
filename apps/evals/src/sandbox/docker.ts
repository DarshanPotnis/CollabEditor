/**
 * The docker CLI, run as a child process with an allowlisted environment:
 * only what it needs to find the daemon. Nothing else of this process's
 * environment reaches it, and nothing at all reaches a container, which gets
 * only the variables session-container.ts gives it.
 */
import { spawn } from 'node:child_process';

const PASSED_TO_DOCKER = [
  'PATH',
  'HOME',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
  'XDG_RUNTIME_DIR',
] as const;

export function dockerEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const passed: Record<string, string> = {};
  for (const name of PASSED_TO_DOCKER) {
    const value = env[name];
    if (value !== undefined) passed[name] = value;
  }
  return passed;
}

export type DockerResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

/** Output kept from one command; the rest is dropped, not buffered. */
const MAX_OUTPUT_CHARS = 8 * 1024 * 1024;

export type DockerOptions = { timeoutMs: number; signal?: AbortSignal };

/** Runs `docker <args>` to the end, or kills the CLI when it runs out of time or is stopped. */
export function docker(
  args: readonly string[],
  { timeoutMs, signal }: DockerOptions,
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { env: dockerEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk;
    });
    const kill = (): void => {
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    signal?.addEventListener('abort', kill, { once: true });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

export type DockerStream = {
  /** The CLI's exit code, which for `docker exec` is the program's. */
  exit: Promise<number>;
};

/** Runs `docker <args>`, handing its output over as it arrives. */
export function dockerStream(
  args: readonly string[],
  onOutput: (chunk: string) => void,
): DockerStream {
  const child = spawn('docker', args, { env: dockerEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);
  const exit = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? -1));
  });
  return { exit };
}

/** Whether a Docker daemon answers. */
export async function dockerAvailable(): Promise<boolean> {
  try {
    const result = await docker(['version', '--format', '{{.Server.Version}}'], {
      timeoutMs: 15_000,
    });
    return result.code === 0 && result.stdout.trim() !== '';
  } catch (error) {
    // No docker CLI installed at all: that answers the question.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
