/**
 * What the run tools (run_project, stop_project, read_terminal, http_request,
 * run_command) tell the model, word for word, whichever host runs them: the
 * browser's WebContainer (apps/web runtime-tools.ts) or the evals' Docker
 * sandbox (apps/evals). Keeping the words and limits in one place means an
 * eval measures the agent the person gets.
 *
 * Hosts pass in the recent output already made plain (agentTerminalText), and
 * only as a function, so it is read only when a message includes it.
 */
import type { ToolOutcome } from '../types.js';
import type { ApiResult } from './request-codec.js';
import { formatBody } from './response-body.js';

/** Booting, installing and starting the project may take this long. */
export const RUN_WAIT_MS = 120_000;
/** A command is stopped after this long. */
export const COMMAND_TIMEOUT_MS = 60_000;
/** Output a command may print that is kept, before the last lines are taken. */
export const COMMAND_OUTPUT_CHARS = 200_000;
/** Lines of recent output added to a run's result. */
export const TAIL_LINES = 40;
/** read_terminal's default. */
export const DEFAULT_TERMINAL_LINES = 80;
const COMMAND_LINES = 150;
const MAX_HEADER_LINES = 20;
const MAX_HEADER_CHARS = 200;

export const RUN_MESSAGES = {
  stopped: 'Stopped.',
  syncDelayed:
    'Sync is delayed: your latest edits have not reached the running project yet. Wait a few seconds and try again. If it keeps happening, the connection may be down.',
  notRunning: 'The project is not running.',
  callRunFirst: "The project isn't running. Call run_project first.",
  startForCommands:
    'Start the project with run_project first, so there is a sandbox to run commands in.',
  noOutputYet: 'There is no output yet. Call run_project to start the project.',
  projectStopped: 'The project is stopped.',
  serverCrashed: 'The server is down: the program crashed.',
} as const;

const ok = (output: string): ToolOutcome => ({ ok: true, output });
const refuse = (output: string): ToolOutcome => ({ ok: false, output });

/** What every run tool answers once the sandbox could not start: the same words each time. */
export function sandboxUnavailable(reason: string): string {
  return [
    `The sandbox isn't available in this session, so code can't run here. The reason: ${reason}`,
    'Do not call run_project, run_command or http_request again in this session: they will give this same answer.',
    'Finish the change without running it, then call finish, and say in your summary that the change is not tested and that the person can click Run to check it.',
  ].join('\n');
}

/** The last `count` lines of plain terminal text. */
export function lastLines(text: string, count: number): string {
  return text === '' ? '' : text.split('\n').slice(-count).join('\n');
}

/** A message with the recent output after it, when there is any. */
export function withOutput(message: string, recent: string): string {
  return recent === '' ? message : `${message}\n\nRecent output:\n${recent}`;
}

/** Where a run stands, in the terms both hosts can say. */
export type RunView =
  | { phase: 'serving'; port: number }
  | { phase: 'crashed' }
  | { phase: 'failed'; message: string }
  | { phase: 'stopped' }
  | { phase: 'starting'; stage: string };

/** run_project's answer once the run has settled, one way or another. */
export function describeRun(view: RunView, recent: () => string): ToolOutcome {
  switch (view.phase) {
    case 'serving':
      return ok(
        withOutput(`The project is running and serving on port ${String(view.port)}.`, recent()),
      );
    case 'crashed':
      return refuse(withOutput('The project crashed.', recent()));
    case 'failed':
      return refuse(withOutput(`The run failed: ${view.message}`, recent()));
    case 'stopped':
      return refuse(RUN_MESSAGES.notRunning);
    case 'starting':
      return refuse(withOutput(`The project is still starting (${view.stage}).`, recent()));
  }
}

/** run_project's answer when the run has not settled within RUN_WAIT_MS. */
export function stillStarting(stage: string, recent: () => string): ToolOutcome {
  return refuse(
    withOutput(
      `The project is still starting after ${String(RUN_WAIT_MS / 1000)} seconds (${stage}).`,
      recent(),
    ),
  );
}

/** http_request's answer: the response as the model reads it, or why there is none. */
export function describeHttpResult(result: ApiResult, recent: () => string): ToolOutcome {
  switch (result.kind) {
    case 'request-failed':
      return refuse(withOutput(`The request failed: ${result.message}`, recent()));
    case 'invalid-output':
      return refuse(`The request could not be read: ${result.message}`);
    case 'response': {
      const { response } = result;
      const headers = response.headers
        .slice(0, MAX_HEADER_LINES)
        .map(([name, value]) => `${name}: ${value.slice(0, MAX_HEADER_CHARS)}`);
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
      return ok(response.status >= 500 ? withOutput(text, recent()) : text);
    }
  }
}

/** The status in http_request's answer (describeHttpResult), or null when it got none. */
export function answeredStatus(output: string): number | null {
  const status = /^HTTP (\d{3}) /.exec(output)?.[1];
  return status === undefined ? null : Number(status);
}

/** How a command ended. */
export type CommandEnd =
  { kind: 'exited'; code: number; seconds: number } | { kind: 'timeout' } | { kind: 'stopped' };

/** run_command's answer, from what the command printed (made plain). */
export function describeCommand(
  command: string,
  args: readonly string[],
  end: CommandEnd,
  printed: string,
): ToolOutcome {
  const lines = lastLines(printed, COMMAND_LINES);
  const shown = lines === '' ? '(no output)' : lines;
  switch (end.kind) {
    case 'stopped':
      return refuse(RUN_MESSAGES.stopped);
    case 'timeout':
      return refuse(
        `${command} was stopped after ${String(COMMAND_TIMEOUT_MS / 1000)} seconds.\n${shown}`,
      );
    case 'exited': {
      const summary = `${[command, ...args].join(' ')} exited with code ${String(end.code)} after ${end.seconds.toFixed(1)} s.\n${shown}`;
      return end.code === 0 ? ok(summary) : refuse(summary);
    }
  }
}

/** The exit code in run_command's answer for this command line (describeCommand), or null when it did not run to one. */
export function exitCodeOf(output: string, commandLine: string): number | null {
  const prefix = `${commandLine} exited with code `;
  if (!output.startsWith(prefix)) return null;
  const code = /^-?\d+/.exec(output.slice(prefix.length))?.[0];
  return code === undefined ? null : Number(code);
}
