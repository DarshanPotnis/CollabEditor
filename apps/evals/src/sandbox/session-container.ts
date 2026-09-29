/**
 * One sandbox container per agent session: the evals' WebContainer.
 * Model-written code runs only in here (docs/decisions/010-evals.md):
 *
 * - no network: `--network none` leaves only loopback, so the project's own
 *   server is reachable (from inside) and nothing else is;
 * - as the host's own non-root user, with no capabilities and no way to gain
 *   privileges;
 * - a read-only root filesystem; the project directory is the only writable
 *   mount, and /tmp a small in-memory scratch;
 * - memory, CPU and process-count limits, and every command bounded in time
 *   by the caller;
 * - an environment of exactly the variables set here: never this process's,
 *   so never the key.
 *
 * The container idles (`sleep infinity`, reaped by --init) and everything
 * runs in it with `docker exec`: the project's server, commands, the request
 * helper and the port probe. A process that must be stoppable is started in a
 * process group of its own, whose id it writes to /tmp, so the whole group
 * can be killed from outside.
 */
import { docker, dockerStream, type DockerResult, type DockerStream } from './docker.js';
import { listeningPorts } from './listening-ports.js';

export const SANDBOX_LIMITS = {
  memory: '768m',
  cpus: '1.5',
  pids: 256,
  tmpfs: '128m',
} as const;

/** The port a project is told to use; any port it listens on is found anyway. */
export const SANDBOX_PORT = 3000;
/** Where the project directory is mounted, the container's working directory. */
export const PROJECT_MOUNT = '/work/project';

const DOCKER_CALL_MS = 30_000;
const LABEL = 'collabcode-eval-run';

let started = 0;

export type SessionContainerOptions = {
  image: string;
  /** The host directory that becomes the project; the only thing the container can write. */
  projectDir: string;
  /** Labels the container, so a run can remove everything it started. */
  runId: string;
};

export type ProcessGroup = DockerStream & { kill: () => Promise<void> };

export class SessionContainer {
  private constructor(readonly name: string) {}

  static async start({
    image,
    projectDir,
    runId,
  }: SessionContainerOptions): Promise<SessionContainer> {
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    if (uid === undefined || gid === undefined || uid === 0) {
      throw new Error(
        'The evals run their sandbox as your own user, which must not be root. Run them as an ordinary user.',
      );
    }
    started += 1;
    const name = `collabcode-eval-${runId}-${String(started)}`;
    const args = [
      'run',
      '--detach',
      '--init',
      '--name',
      name,
      '--label',
      `${LABEL}=${runId}`,
      '--network',
      'none',
      '--user',
      `${String(uid)}:${String(gid)}`,
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--read-only',
      '--tmpfs',
      `/tmp:rw,nosuid,nodev,size=${SANDBOX_LIMITS.tmpfs},mode=1777`,
      '--memory',
      SANDBOX_LIMITS.memory,
      '--memory-swap',
      SANDBOX_LIMITS.memory,
      '--cpus',
      SANDBOX_LIMITS.cpus,
      '--pids-limit',
      String(SANDBOX_LIMITS.pids),
      '--mount',
      `type=bind,source=${projectDir},target=${PROJECT_MOUNT}`,
      '--workdir',
      PROJECT_MOUNT,
      '--env',
      'HOME=/tmp',
      '--env',
      `PORT=${String(SANDBOX_PORT)}`,
      '--env',
      'NODE_ENV=development',
      image,
      'sleep',
      'infinity',
    ];
    const result = await docker(args, { timeoutMs: DOCKER_CALL_MS });
    if (result.code !== 0)
      throw new Error(`The sandbox container did not start: ${result.stderr.trim()}`);
    return new SessionContainer(name);
  }

  /** Runs a program in the container to its end, or until it runs out of time or is stopped. */
  exec(
    argv: readonly string[],
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<DockerResult> {
    return docker(['exec', this.name, ...argv], options);
  }

  /** Starts a program in a process group of its own, streaming its output. */
  group(id: string, argv: readonly string[], onOutput: (chunk: string) => void): ProcessGroup {
    const stream = dockerStream(
      [
        'exec',
        this.name,
        // --wait: without it setsid may fork and return at once, which looks like an exit.
        'setsid',
        '--wait',
        'sh',
        '-c',
        'echo $$ > "/tmp/group-$0.pid"; exec "$@"',
        id,
        ...argv,
      ],
      onOutput,
    );
    return {
      ...stream,
      kill: async () => {
        await this.exec(
          // dash's kill takes a negative pid as a group, but not `--`.
          ['sh', '-c', 'kill -9 -"$(cat "/tmp/group-$0.pid")" 2>/dev/null; true', id],
          { timeoutMs: DOCKER_CALL_MS },
        );
      },
    };
  }

  /** The ports something in the container listens on. */
  async listeningPorts(): Promise<number[]> {
    const result = await this.exec(['cat', '/proc/net/tcp', '/proc/net/tcp6'], {
      timeoutMs: DOCKER_CALL_MS,
    });
    return result.code === 0 ? listeningPorts(result.stdout) : [];
  }

  async remove(): Promise<void> {
    await docker(['rm', '--force', this.name], { timeoutMs: DOCKER_CALL_MS });
  }

  /** Removes every container a run started, including any a crash left behind. */
  static async removeRun(runId: string): Promise<void> {
    const listed = await docker(['ps', '--all', '--quiet', '--filter', `label=${LABEL}=${runId}`], {
      timeoutMs: DOCKER_CALL_MS,
    });
    const ids = listed.stdout.split('\n').filter((id) => id.trim() !== '');
    if (ids.length > 0) await docker(['rm', '--force', ...ids], { timeoutMs: DOCKER_CALL_MS });
  }
}
