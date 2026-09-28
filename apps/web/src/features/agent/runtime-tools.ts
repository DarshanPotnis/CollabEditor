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
 */
import type { RuntimeToolCall, RuntimeTools, StopSignal, ToolOutcome } from '@collabcode/agent';
import type { AgentToolInput } from '@collabcode/shared';
import type { ApiRequest, ApiResult } from '../runtime/api-console/request-codec.js';
import { formatBody } from '../runtime/api-console/response-format.js';
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
import { agentTerminalText } from './agent-terminal-text.js';

/** Booting, installing and starting the project may take this long. */
export const RUN_WAIT_MS = 120_000;
/** A command is stopped after this long. */
export const COMMAND_TIMEOUT_MS = 60_000;
/** How long output may keep arriving after a command exits; a killed one may never close it. */
export const OUTPUT_GRACE_MS = 500;
const COMMAND_OUTPUT_CHARS = 200_000;
const TAIL_LINES = 40;
const DEFAULT_TERMINAL_LINES = 80;
const MAX_HEADER_LINES = 20;

export const SYNC_DELAYED =
  'Sync is delayed: your latest edits have not reached the running project yet. Wait a few seconds and try again. If it keeps happening, the connection may be down.';

/** What every run tool answers once the sandbox could not start: the same words each time. */
export function sandboxUnavailable(reason: string): string {
  return [
    `The sandbox isn't available in this session, so code can't run here. The reason: ${reason}`,
    'Do not call run_project, run_command or http_request again in this session: they will give this same answer.',
    'Finish the change without running it, then call finish, and say in your summary that the change is not tested and that the person can click Run to check it.',
  ].join('\n');
}

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
const STOPPED = refuse('Stopped.');

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
  now,
}: RuntimeToolsDeps): RuntimeTools {
  const tail = (lines: number): string => {
    const text = agentTerminalText(runtime.output.recent(100_000));
    return text === '' ? '' : text.split('\n').slice(-lines).join('\n');
  };
  const withOutput = (message: string, lines = TAIL_LINES): string => {
    const recent = tail(lines);
    return recent === '' ? message : `${message}\n\nRecent output:\n${recent}`;
  };

  const delayed = (): Barrier => {
    onNotice('Sync with the running project is delayed.');
    return { ok: false, outcome: refuse(SYNC_DELAYED) };
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
      return { ok: false, outcome: refuse(withOutput(error.message)) };
    }
  };

  const describeRun = (state: RunState): ToolOutcome => {
    switch (state.phase) {
      case 'serving':
        return ok(
          withOutput(`The project is running and serving on port ${String(state.server.port)}.`),
        );
      case 'crashed':
        return refuse(withOutput('The project crashed.'));
      case 'failed':
        return refuse(withOutput(`The run failed: ${state.message}`));
      case 'stopped':
      case 'idle':
        return refuse('The project is not running.');
      default:
        return refuse(withOutput(`The project is still starting (${state.phase}).`));
    }
  };

  /** Why the sandbox could not start, once it has failed to; it is not tried again. */
  let unavailable: string | null = null;

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
    if (settled === null) {
      return refuse(
        withOutput(
          `The project is still starting after ${String(RUN_WAIT_MS / 1000)} seconds (${runtime.state().phase}).`,
        ),
      );
    }
    return describeRun(settled);
  };

  const readTerminal = ({ lines }: AgentToolInput<'read_terminal'>): ToolOutcome => {
    const recent = tail(lines ?? DEFAULT_TERMINAL_LINES);
    return recent === ''
      ? ok('There is no output yet. Call run_project to start the project.')
      : ok(recent);
  };

  const formatResult = (result: ApiResult): ToolOutcome => {
    switch (result.kind) {
      case 'request-failed':
        return refuse(withOutput(`The request failed: ${result.message}`));
      case 'invalid-output':
        return refuse(`The request could not be read: ${result.message}`);
      case 'response': {
        const { response } = result;
        const headers = response.headers
          .slice(0, MAX_HEADER_LINES)
          .map(([name, value]) => `${name}: ${value.slice(0, 200)}`);
        const body = formatBody(response.body, response.headers);
        const shown =
          body.kind === 'empty'
            ? '(empty body)'
            : body.kind === 'binary'
              ? `(binary, ${String(body.size)} bytes: ${body.preview})`
              : body.text;
        const cut = response.truncated
          ? `\n…[body truncated: ${String(response.size)} bytes in all]`
          : '';
        const text = [
          `HTTP ${String(response.status)} ${response.statusText}, ${String(Math.round(response.ms))} ms`,
          ...headers,
          '',
          `${shown}${cut}`,
        ].join('\n');
        // A server error usually printed its stack trace; saves the model a step.
        return ok(response.status >= 500 ? withOutput(text) : text);
      }
    }
  };

  const httpRequest = async (
    { method, path, headers, body }: AgentToolInput<'http_request'>,
    signal: AbortSignal,
  ): Promise<ToolOutcome> => {
    const ready = await barrier(signal);
    if (!ready.ok) return ready.outcome;
    const { state } = ready;
    if (state.phase === 'crashed') {
      return refuse(withOutput('The server is down: the program crashed.'));
    }
    if (state.phase === 'idle' || state.phase === 'stopped') {
      return refuse("The project isn't running. Call run_project first.");
    }
    let port: number;
    try {
      port = (await runtime.waitForServer()).port;
    } catch (error) {
      if (error instanceof ServerUnavailableError) return refuse(withOutput(error.message));
      throw error;
    }
    const container = runtime.container();
    if (!container) return refuse("The project isn't running. Call run_project first.");
    const request: ApiRequest = {
      method,
      path,
      headers: (headers ?? []).map(({ name, value }): [string, string] => [name, value]),
      body: body ?? null,
    };
    const result = await unlessStopped(sendRequest(container, port, request), signal, null);
    return result === null ? STOPPED : formatResult(result);
  };

  const runCommand = async (
    { command, args }: AgentToolInput<'run_command'>,
    signal: AbortSignal,
  ): Promise<ToolOutcome> => {
    const ready = await barrier(signal);
    if (!ready.ok) return ready.outcome;
    const container = runtime.container();
    if (!container) {
      return refuse(
        'Start the project with run_project first, so there is a sandbox to run commands in.',
      );
    }
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
    const seconds = ((now() - started) / 1000).toFixed(1);
    const printed = agentTerminalText(text).split('\n').slice(-150).join('\n');
    const shown = printed === '' ? '(no output)' : printed;
    if (outcome === 'stopped') return STOPPED;
    if (outcome === 'timeout') {
      return refuse(
        `${command} was stopped after ${String(COMMAND_TIMEOUT_MS / 1000)} seconds.\n${shown}`,
      );
    }
    const summary = `${[command, ...args].join(' ')} exited with code ${String(code)} after ${seconds} s.\n${shown}`;
    return code === 0 ? ok(summary) : refuse(summary);
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
            return ok('The project is stopped.');
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
