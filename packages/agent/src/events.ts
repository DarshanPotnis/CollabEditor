/**
 * What a running session reports as it goes: the panel's step log and the
 * agent's status in awareness are built from these. The trace holds the same
 * facts, kept for later.
 */
import type { AiFinishReason, AiProvider } from '@collabcode/shared';
import type { SessionChanges } from './session-changes.js';
import type { AgentOutcome, AgentTotals } from './trace.js';
import type { TokenUsage } from './types.js';

export type AgentEvent =
  | { type: 'step-started'; step: number; maxSteps: number }
  | { type: 'text'; step: number; delta: string }
  | { type: 'waiting'; step: number; reason: 'busy' | 'rate-limited'; waitMs: number }
  | {
      type: 'model-answered';
      step: number;
      finishReason: AiFinishReason;
      usage: TokenUsage;
      model: { provider: AiProvider; id: string };
      remainingToday: number | null;
    }
  | { type: 'tool-started'; step: number; toolCallId: string; toolName: string; input: unknown }
  | {
      type: 'tool-finished';
      step: number;
      toolCallId: string;
      toolName: string;
      isError: boolean;
      output: string;
      durationMs: number;
    }
  /** A ModelClient or ToolHost broke its contract by throwing; the caller should log it. */
  | { type: 'crashed'; where: 'model' | 'tool'; error: unknown }
  | {
      type: 'finished';
      outcome: AgentOutcome;
      totals: AgentTotals;
      /** What it changed, from its trace: the panel's summary when the model gave none. */
      changes: SessionChanges;
    };
