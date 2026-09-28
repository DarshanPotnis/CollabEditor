/**
 * A ToolHost from its two halves: the file tools, which only need a Y.Doc and
 * are the same everywhere (doc-tools/), and the tools that run the project,
 * which each environment provides (the browser's WebContainer; the evals'
 * child processes).
 */
import { isDocToolCall, type DocTools } from './doc-tools/file-tools.js';
import type { HostToolCall, StopSignal, ToolHost, ToolOutcome } from './types.js';

export type RuntimeToolName =
  'run_project' | 'stop_project' | 'read_terminal' | 'http_request' | 'run_command';
export type RuntimeToolCall = Extract<HostToolCall, { name: RuntimeToolName }>;

export type RuntimeTools = {
  execute: (call: RuntimeToolCall, signal: StopSignal) => Promise<ToolOutcome>;
};

export function composeToolHost(docTools: DocTools, runtime: RuntimeTools): ToolHost {
  return {
    execute: (call, signal) =>
      isDocToolCall(call) ? docTools.execute(call, signal) : runtime.execute(call, signal),
  };
}
