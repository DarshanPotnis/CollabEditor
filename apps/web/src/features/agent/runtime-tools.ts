/**
 * The agent's tools that run the project, in the person's WebContainer
 * (docs/PLAN-AI.md §4): run_project, stop_project, read_terminal, http_request
 * and run_command. They use the same runner, output and API console helper as
 * the Run view, so the person watches the agent's runs happen there.
 *
 * Anything that runs code first passes the settle barrier: the person's
 * document must have the agent's edits (doc-sync.ts), and the container must
 * have them and have restarted on them (the runner's settle). Both waits are
 * bounded; when one runs out the model is told that sync is delayed, and the
 * person sees a notice, instead of the agent testing old code.
 *
 * A sandbox that could not start stays unavailable for the rest of the
 * session: from then on run_project, run_command and http_request give one
 * fixed answer at once, so the model is not led into retrying something that
 * cannot work (a recorded session called run_command six times after it).
 *
 * What the tools say is @collabcode/agent's run-text, the same words the
 * evals' sandbox uses; this module supplies the WebContainer behind them.
 */
import {
  COMMAND_OUTPUT_CHARS,
  COMMAND_TIMEOUT_MS,
  DEFAULT_TERMINAL_LINES,
  RUN_MESSAGES,
  RUN_WAIT_MS,
  TAIL_LINES,
  agentTerminalText,
  describeCommand,
  describeHttpResult,
  describeRun,
  lastLines,
  sandboxUnavailable,
  stillStarting,
  withOutput,
  type ApiRequest,
  type ApiResult,
  type CommandEnd,
  type RunView,
  type RuntimeToolCall,
  type RuntimeTools,
  type StopSignal,
  type ToolOutcome,
} from '@collabcode/agent';
import type { AgentToolInput } from '@collabcode/shared';
import type { Container } from '../runtime/container.js';
import type { OutputBuffer } from '../runtime/output-buffer.js';
import {
  ServerUnavailableError,
  SettleError,
  isSettled,
  type Runner,
} from '../runtime/process-runner.js';
import type { RunState } from '../runtime/run-state.js';
import { abortSignalFor } from './abort-signal.js';

/** How long output may keep arriving after a command exits; a killed one may never close it. */
export const OUTPUT_GRACE_MS = 500;

export type AgentRuntime = Pick<
  Runner,
  'state' | 'run' | 'stop' | 'settle' | 'whenState' | 'waitForServer' | 'container'
> & { output: OutputBuffer };

export type RuntimeToolsDeps = {
  runtime: AgentRuntime;
  /** True once the person's document has the agent's edits; false when that took too long. */
  docSynced: (signal: AbortSignal) => Promise<boolean>;
  sendRequest: (container: Container, port: number, request: ApiRequest) => Promise<ApiResult>;
  /** Something the person should see in the panel, such as sync being delayed. */
  onNotice: (message: string) => void;
  /** Why this page cannot run code, known before the session starts; null when it can. */
  sandboxProblem: string | null;
  now: () => number;
};

/** The tools that need a sandbox to run in. */
const SANDBOX_TOOLS: ReadonlySet<RuntimeToolCall['name']> = new Set([
  'run_project',
  'run_command',
  'http_request',
]);

const ok = (output: string): ToolOutcome => ({ ok: true, output });
const refuse = (output: string): ToolOutcome => ({ ok: false, output });
const STOPPED = refuse(RUN_MESSAGES.stopped);

/** The runner's state in the words run-text knows. */
function runView(state: RunState): RunView {
  switch (state.phase) {
    case 'serving':
      return { phase: 'serving', port: state.server.port };
    case 'crashed':
      return { phase: 'crashed' };
    case 'failed':
      return { phase: 'failed', message: state.message };
    case 'stopped':
    case 'idle':
      return { phase: 'stopped' };
    default:
      return { phase: 'starting', stage: state.phase };
  }
}

type Barrier = { ok: true; state: RunState } | { ok: false; outcome: ToolOutcome };

/** Settles as `work` does, or with `onStop` as soon as `signal` stops. */
function unlessStopped<T>(work: Promise<T>, signal: AbortSignal, onStop: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = (): void => resolve(onStop);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

export function createRuntimeTools({
  runtime,
  docSynced,
  sendRequest,
  onNotice,
  sandboxProblem,
  now,
}: RuntimeToolsDeps): RuntimeTools {
  const tail = (lines: number): string =>
    lastLines(agentTerminalText(runtime.output.recent(100_000)), lines);
  const recent = (): string => tail(TAIL_LINES);

  const delayed = (): Barrier => {
    onNotice('Sync with the running project is delayed.');
    return { ok: false, outcome: refuse(RUN_MESSAGES.syncDelayed) };
  };

  /** The agent's edits are in the person's document and in the container, and any restart is over. */
  const barrier = async (signal: AbortSignal): Promise<Barrier> => {
    if (!(await docSynced(signal)))
      return signal.aborted ? { ok: false, outcome: STOPPED } : delayed();
    try {
      const state = await runtime.settle({ signal });
      return signal.aborted ? { ok: false, outcome: STOPPED } : { ok: true, state };
    } catch (error) {
      if (!(error instanceof SettleError)) throw error;
      if (error.stage === 'write') return delayed();
      return { ok: false, outcome: refuse(withOutput(error.message, recent())) };
    }
  };

  /** Why the sandbox cannot start, once that is known; it is not tried again. */
  let unavailable = sandboxProblem;

  const runProject = async (signal: AbortSignal): Promise<ToolOutcome> => {
    const ready = await barrier(signal);
    if (!ready.ok) return ready.outcome;
    void runtime.run();
    const settled = await runtime.whenState(isSettled, RUN_WAIT_MS, signal);
    if (signal.aborted) return STOPPED;
    // Failed with no container: it never booted, so nothing will run in this session.
    if (settled?.phase === 'failed' && runtime.container() === null) {
      unavailable = settled.message;
      onNotice(
        `The project can't run here, so the AI teammate can't test its change. ${unavailable}`,
      );
      return refuse(sandboxUnavailable(unavailable));
    }
    if (settled === null) return stillStarting(runtime.state().phase, recent);
    return describeRun(runView(settled), recent);
  };

  const readTerminal = ({ lines }: AgentToolInput<'read_terminal'>): ToolOutcome => {
    const shown = tail(lines ?? DEFAULT_TERMINAL_LINES);
    return ok(shown === '' ? RUN_MESSAGES.noOutputYet : shown);
  };

  const httpRequest = async (
    { method, path, headers, body }: AgentToolInput<'http_request'>,
    signal: AbortSignal,
  ): Promise<ToolOutcome> => {
    const ready = await barrier(signal);
    if (!ready.ok) return ready.outcome;
    const { state } = ready;
    if (state.phase === 'crashed') {
      return refuse(withOutput(RUN_MESSAGES.serverCrashed, recent()));
    }
    if (state.phase === 'idle' || state.phase === 'stopped') {
      return refuse(RUN_MESSAGES.callRunFirst);
    }
    let port: number;
    try {
      port = (await runtime.waitForServer()).port;
    } catch (error) {
      if (error instanceof ServerUnavailableError) {
        return refuse(withOutput(error.message, recent()));
      }
      throw error;
    }
    const container = runtime.container();
    if (!container) return refuse(RUN_MESSAGES.callRunFirst);
    const request: ApiRequest = {
      method,
      path,
      headers: (headers ?? []).map(({ name, value }): [string, string] => [name, value]),
      body: body ?? null,
    };
    const result = await unlessStopped(sendRequest(container, port, request), signal, null);
    return result === null ? STOPPED : describeHttpResult(result, recent);
  };

  const runCommand = async (
    { command, args }: AgentToolInput<'run_command'>,
    signal: AbortSignal,
  ): Promise<ToolOutcome> => {
    const ready = await barrier(signal);
    if (!ready.ok) return ready.outcome;
    const container = runtime.container();
    if (!container) return refuse(RUN_MESSAGES.startForCommands);
    const started = now();
    const child = await container.spawn(command, args);
    let text = '';
    const piping = new AbortController();
    const reading = child.output
      .pipeTo(
        new WritableStream({
          write(chunk) {
            if (text.length < COMMAND_OUTPUT_CHARS) text += chunk;
          },
        }),
        { signal: piping.signal },
      )
      .catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await unlessStopped<'exited' | 'timeout' | 'stopped'>(
      Promise.race([
        child.exit.then(() => 'exited' as const),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), COMMAND_TIMEOUT_MS);
        }),
      ]),
      signal,
      'stopped',
    );
    clearTimeout(timer);
    if (outcome !== 'exited') child.kill();
    const code = await child.exit;
    await Promise.race([
      reading,
      new Promise((resolve) => {
        timer = setTimeout(resolve, OUTPUT_GRACE_MS);
      }),
    ]);
    clearTimeout(timer);
    piping.abort();
    const end: CommandEnd =
      outcome === 'exited'
        ? { kind: 'exited', code, seconds: (now() - started) / 1000 }
        : { kind: outcome };
    return describeCommand(command, args, end, agentTerminalText(text));
  };

  return {
    async execute(call: RuntimeToolCall, stop: StopSignal) {
      if (unavailable !== null && SANDBOX_TOOLS.has(call.name)) {
        return refuse(sandboxUnavailable(unavailable));
      }
      const { signal, dispose } = abortSignalFor(stop);
      try {
        switch (call.name) {
          case 'run_project':
            return await runProject(signal);
          case 'stop_project':
            runtime.stop();
            return ok(RUN_MESSAGES.projectStopped);
          case 'read_terminal':
            return readTerminal(call.input);
          case 'http_request':
            return await httpRequest(call.input, signal);
          case 'run_command':
            return await runCommand(call.input, signal);
        }
      } finally {
        dispose();
      }
    },
  };
}
