/**
 * The run tools (run_project, stop_project, read_terminal, http_request,
 * run_command) over the evals' Docker sandbox: the Node counterpart of the
 * browser's runtime-tools.ts, saying the same things (run-text) so an eval
 * measures the agent people get.
 *
 * - Before anything runs, the agent's document is written to the project
 *   directory; a server that was running restarts when that changed anything,
 *   the way `node --watch` restarts in the WebContainer and the browser's
 *   settle barrier waits for it. Here the restart is explicit, so it is
 *   deterministic.
 * - Nothing is installed: the sandbox has no network. A fixture's
 *   dependencies are in the image; a project that needs any other package
 *   fails to start, and says why.
 * - The server is whatever listens: found from /proc/net/tcp, whatever port.
 * - HTTP requests run inside the container with the same request helper the
 *   browser uses, so the project's server is reached on loopback and nothing
 *   else is reachable.
 * - A task can make the sandbox unavailable, known before the session starts
 *   or found out at the first run_project, and the tools then answer as the
 *   browser's do.
 */
import {
  COMMAND_OUTPUT_CHARS,
  COMMAND_TIMEOUT_MS,
  DEFAULT_TERMINAL_LINES,
  REQUEST_SCRIPT,
  REQUEST_TIMEOUT_MS,
  RUN_MESSAGES,
  RUN_WAIT_MS,
  TAIL_LINES,
  agentTerminalText,
  createNonce,
  describeCommand,
  describeHttpResult,
  describeRun,
  encodeRequest,
  lastLines,
  parseHelperOutput,
  runPlan,
  sandboxUnavailable,
  stillStarting,
  watchForCrashes,
  withOutput,
  type CommandEnd,
  type RunView,
  type RuntimeToolCall,
  type RuntimeTools,
  type StopSignal,
  type ToolOutcome,
} from '@collabcode/agent';
import type { AgentToolInput } from '@collabcode/shared';
import { z } from 'zod';
import type { ProjectDir } from './project-dir.js';
import { SANDBOX_PORT, type ProcessGroup, type SessionContainer } from './session-container.js';
import { shiftStackLines } from './stack-shift.js';

export type SandboxAvailability =
  | { kind: 'available' }
  /** The page is known not to run code before the session starts. */
  | { kind: 'unavailable-known'; reason: string }
  /** Found out at the first run_project, as a boot that failed. */
  | { kind: 'unavailable-discovered'; reason: string };

export type SandboxRuntimeOptions = {
  container: SessionContainer;
  project: ProjectDir;
  /** The agent's document as files, now. */
  files: () => ReadonlyMap<string, string>;
  /** What the image has installed. */
  baked: ReadonlySet<string>;
  availability: SandboxAvailability;
  /** Emulates WebContainer's ES-module line shift on printed stack frames (0 for none). */
  stackShift: number;
  now: () => number;
};

export type SandboxRuntime = RuntimeTools & {
  /** Stops the project's server, for the end of a session. */
  dispose: () => Promise<void>;
};

type ServerState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'serving'; port: number }
  | { phase: 'crashed' }
  | { phase: 'failed'; message: string }
  | { phase: 'stopped' };

const PROBE_EVERY_MS = 250;
const KILL_WAIT_MS = 5_000;
const OUTPUT_KEPT_CHARS = 200_000;
const REQUEST_BACKSTOP_MS = REQUEST_TIMEOUT_MS + 10_000;

const ok = (output: string): ToolOutcome => ({ ok: true, output });
const refuse = (output: string): ToolOutcome => ({ ok: false, output });
const STOPPED = refuse(RUN_MESSAGES.stopped);

const SANDBOX_TOOLS: ReadonlySet<RuntimeToolCall['name']> = new Set([
  'run_project',
  'run_command',
  'http_request',
]);

const packageJsonSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

/** The packages a project asks for, or none when its package.json cannot say. */
function wantedPackages(packageJson: string | undefined): string[] {
  if (packageJson === undefined) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(packageJson);
  } catch {
    // runPlan reports an unparseable package.json; nothing to check here.
    return [];
  }
  const parsed = packageJsonSchema.safeParse(raw);
  if (!parsed.success) return [];
  return [
    ...Object.keys(parsed.data.dependencies ?? {}),
    ...Object.keys(parsed.data.devDependencies ?? {}),
  ];
}

/** The agent's StopSignal as an AbortSignal, for the calls that take one. */
function abortSignalFor(stop: StopSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (stop.aborted) abort();
  else stop.addEventListener('abort', abort, { once: true });
  return { signal: controller.signal, dispose: () => stop.removeEventListener('abort', abort) };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function within<T>(work: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(onTimeout), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createSandboxRuntime(options: SandboxRuntimeOptions): SandboxRuntime {
  const { container, project, files, baked, availability, stackShift, now } = options;
  let state: ServerState = { phase: 'idle' };
  let server: ProcessGroup | null = null;
  let booted = false;
  let groups = 0;
  let output = '';
  let unavailable = availability.kind === 'unavailable-known' ? availability.reason : null;

  const append = (chunk: string): void => {
    output = (output + chunk).slice(-OUTPUT_KEPT_CHARS);
  };
  const tail = (lines: number): string =>
    lastLines(agentTerminalText(shiftStackLines(output, stackShift)), lines);
  const recent = (): string => tail(TAIL_LINES);

  const stopServer = async (): Promise<void> => {
    const running = server;
    server = null;
    if (!running) return;
    await running.kill();
    await within(running.exit, KILL_WAIT_MS, -1);
  };

  /** (Re)starts the project and waits until it serves, crashes, runs out of time or is stopped. */
  const startServer = async (signal: AbortSignal): Promise<void> => {
    await stopServer();
    const packageJson = files().get('package.json');
    const plan = runPlan(packageJson);
    if (plan.kind === 'problem') {
      state = { phase: 'failed', message: plan.message };
      return;
    }
    const missing = wantedPackages(packageJson).filter((name) => !baked.has(name));
    if (missing.length > 0) {
      state = {
        phase: 'failed',
        message: `npm install cannot run: the eval sandbox has no network, and it has only ${[...baked].join(', ')} installed, not ${missing.join(', ')}.`,
      };
      return;
    }
    append(`$ npm ${plan.args.join(' ')}\r\n`);
    groups += 1;
    // Under `node --watch` a crash does not end the process: the watcher says so and waits.
    const onCrashLine = watchForCrashes(() => {
      if (server === started) state = { phase: 'crashed' };
    });
    const started = container.group(`server-${String(groups)}`, ['npm', ...plan.args], (chunk) => {
      append(chunk);
      onCrashLine(chunk);
    });
    server = started;
    state = { phase: 'starting' };
    void started.exit.then(() => {
      if (server === started) {
        server = null;
        state = { phase: 'crashed' };
      }
    });
    const deadline = now() + RUN_WAIT_MS;
    while (!signal.aborted && state.phase === 'starting' && now() < deadline) {
      const ports = await container.listeningPorts();
      if (state.phase !== 'starting') break;
      if (ports.length > 0) {
        state = {
          phase: 'serving',
          port: ports.includes(SANDBOX_PORT) ? SANDBOX_PORT : (ports[0] ?? SANDBOX_PORT),
        };
        break;
      }
      await sleep(PROBE_EVERY_MS, signal);
    }
  };

  /** The document is on disk, and a server that was running runs the latest of it. */
  const settle = async (signal: AbortSignal): Promise<void> => {
    const changed = await project.sync(files());
    const wasRunning =
      state.phase === 'serving' || state.phase === 'starting' || state.phase === 'crashed';
    if (changed && wasRunning) await startServer(signal);
  };

  const view = (): RunView => {
    switch (state.phase) {
      case 'serving':
        return { phase: 'serving', port: state.port };
      case 'crashed':
        return { phase: 'crashed' };
      case 'failed':
        return { phase: 'failed', message: state.message };
      case 'idle':
      case 'stopped':
        return { phase: 'stopped' };
      case 'starting':
        return { phase: 'starting', stage: 'starting' };
    }
  };

  const runProject = async (signal: AbortSignal): Promise<ToolOutcome> => {
    if (availability.kind === 'unavailable-discovered') {
      unavailable = availability.reason;
      return refuse(sandboxUnavailable(unavailable));
    }
    booted = true;
    await project.sync(files());
    await startServer(signal);
    if (signal.aborted) return STOPPED;
    if (state.phase === 'starting') return stillStarting('starting', recent);
    return describeRun(view(), recent);
  };

  const httpRequest = async (
    { method, path, headers, body }: AgentToolInput<'http_request'>,
    signal: AbortSignal,
  ): Promise<ToolOutcome> => {
    if (!booted) return refuse(RUN_MESSAGES.callRunFirst);
    await settle(signal);
    if (signal.aborted) return STOPPED;
    if (state.phase === 'crashed') return refuse(withOutput(RUN_MESSAGES.serverCrashed, recent()));
    if (state.phase !== 'serving') {
      return state.phase === 'starting'
        ? describeRun(view(), recent)
        : refuse(RUN_MESSAGES.callRunFirst);
    }
    const nonce = createNonce();
    const request = encodeRequest({
      method,
      path,
      headers: (headers ?? []).map(({ name, value }): [string, string] => [name, value]),
      body: body ?? null,
    });
    const result = await container.exec(
      ['node', '-e', REQUEST_SCRIPT, request, nonce, String(state.port)],
      { timeoutMs: REQUEST_BACKSTOP_MS, signal },
    );
    if (signal.aborted) return STOPPED;
    return describeHttpResult(parseHelperOutput(result.stdout, nonce), recent);
  };

  const runCommand = async (
    { command, args }: AgentToolInput<'run_command'>,
    signal: AbortSignal,
  ): Promise<ToolOutcome> => {
    if (!booted) return refuse(RUN_MESSAGES.startForCommands);
    await settle(signal);
    if (signal.aborted) return STOPPED;
    let printed = '';
    groups += 1;
    const started = now();
    const child = container.group(`command-${String(groups)}`, [command, ...args], (chunk) => {
      if (printed.length < COMMAND_OUTPUT_CHARS) printed += chunk;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ended = await Promise.race([
      child.exit.then((code) => ({ kind: 'exited' as const, code })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), COMMAND_TIMEOUT_MS);
      }),
      new Promise<{ kind: 'stopped' }>((resolve) => {
        if (signal.aborted) resolve({ kind: 'stopped' });
        signal.addEventListener('abort', () => resolve({ kind: 'stopped' }), { once: true });
      }),
    ]);
    clearTimeout(timer);
    if (ended.kind !== 'exited') {
      await child.kill();
      await within(child.exit, KILL_WAIT_MS, -1);
    }
    const end: CommandEnd =
      ended.kind === 'exited'
        ? { kind: 'exited', code: ended.code, seconds: (now() - started) / 1000 }
        : ended;
    return describeCommand(
      command,
      args,
      end,
      agentTerminalText(shiftStackLines(printed, stackShift)),
    );
  };

  return {
    async execute(call: RuntimeToolCall, stop: StopSignal): Promise<ToolOutcome> {
      if (unavailable !== null && SANDBOX_TOOLS.has(call.name)) {
        return refuse(sandboxUnavailable(unavailable));
      }
      const { signal, dispose } = abortSignalFor(stop);
      try {
        switch (call.name) {
          case 'run_project':
            return await runProject(signal);
          case 'stop_project':
            await stopServer();
            state = { phase: 'stopped' };
            return ok(RUN_MESSAGES.projectStopped);
          case 'read_terminal': {
            const shown = tail(call.input.lines ?? DEFAULT_TERMINAL_LINES);
            return ok(shown === '' ? RUN_MESSAGES.noOutputYet : shown);
          }
          case 'http_request':
            return await httpRequest(call.input, signal);
          case 'run_command':
            return await runCommand(call.input, signal);
        }
      } finally {
        dispose();
      }
    },
    dispose: stopServer,
  };
}
