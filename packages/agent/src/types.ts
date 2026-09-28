/**
 * The seams between the agent core and the world it runs in (docs/PLAN-AI.md
 * §2). The browser implements each of them one way (a fetch to the server, the
 * live document and the WebContainer); the eval harness (AI-4) another (Node,
 * a temporary directory, child processes). The loop in loop.ts only ever
 * talks to these.
 */
import type {
  AgentToolInput,
  AgentToolName,
  AiFinishReason,
  AiProvider,
  AssistantMessage,
  ConversationEntry,
  PromptInputsFor,
} from '@collabcode/shared';

/**
 * Something that can say "stop". Structurally a subset of the standard
 * AbortSignal, which satisfies it in both the browser and Node.
 */
export type StopSignal = {
  readonly aborted: boolean;
  addEventListener: (type: 'abort', listener: () => void, options?: { once?: boolean }) => void;
  removeEventListener: (type: 'abort', listener: () => void) => void;
};

/** Time, injected so tests can move it by hand. */
export type Clock = {
  now: () => number;
  /** Resolves after `ms`, or as soon as `signal` stops, whichever is first. Never rejects. */
  sleep: (ms: number, signal: StopSignal) => Promise<void>;
};

/** What the agent prompt takes: the goal and the project's file list. */
export type AgentInputs = PromptInputsFor<'agent'>;

export type TokenUsage = { inputTokens: number | null; outputTokens: number | null };

export type ModelStep = {
  /** The model's whole message, to send back unchanged next step. */
  message: AssistantMessage;
  finishReason: AiFinishReason;
  usage: TokenUsage;
  model: { provider: AiProvider; id: string };
  prompt: { id: string; version: number };
  /** Shared-tier requests left today, or null with the person's own key. */
  remainingToday: number | null;
};

export type ModelStepRequest = {
  inputs: AgentInputs;
  conversation: readonly ConversationEntry[];
  signal: StopSignal;
  /** Text the model streams before its tool calls, as it arrives. */
  onText: (delta: string) => void;
};

/** Places one model call. Failures are thrown as ModelStepError, and nothing else. */
export type ModelClient = {
  step: (request: ModelStepRequest) => Promise<ModelStep>;
};

export type ModelStepErrorKind =
  /** The model is overloaded; retrying shortly is reasonable. */
  | 'busy'
  /** A per-minute limit; `retryAfterMs` says how long, when known. */
  | 'rate-limited'
  /** Stopped by the StopSignal. */
  | 'stopped'
  /** Anything else: a used-up allowance, a refused key, a broken connection. */
  | 'failed';

/** A failed model call, with a message written to be shown to a person as-is. */
export class ModelStepError extends Error {
  readonly kind: ModelStepErrorKind;
  /** True when the model had not started answering, so retrying costs nothing twice. */
  readonly upFront: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    kind: ModelStepErrorKind,
    message: string,
    options: { upFront: boolean; retryAfterMs?: number | null },
  ) {
    super(message);
    this.name = 'ModelStepError';
    this.kind = kind;
    this.upFront = options.upFront;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/** A validated call, as the ToolHost receives it. */
export type ToolCall = {
  [Name in AgentToolName]: { name: Name; input: AgentToolInput<Name> };
}[AgentToolName];

/** Every tool except `finish`, which the loop handles itself. */
export type HostToolCall = Exclude<ToolCall, { name: 'finish' }>;

/**
 * What a tool did, as text for the model. `ok: false` is an error the model
 * should read and react to (a missing file, a refused edit), not a crash.
 */
export type ToolOutcome = { ok: boolean; output: string };

/** Carries out tool calls. May throw only for bugs; the loop reports those as failed calls. */
export type ToolHost = {
  execute: (call: HostToolCall, signal: StopSignal) => Promise<ToolOutcome>;
};
