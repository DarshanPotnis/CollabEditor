/**
 * The AI agent's conversation as it travels between the browser and the server
 * (docs/PLAN-AI.md §6.4). The server keeps nothing between steps, so each step
 * carries everything since the prompt's own messages:
 *
 * - the model's messages, exactly as the server sent them in `finish`. Their
 *   `providerOptions` are opaque and must come back unchanged: Gemini's thought
 *   signatures ride there, and without them Gemini 3's tool calling degrades;
 * - the results of its tool calls, as text;
 * - a nudge when it answered without calling a tool. The words are the
 *   prompt's; the client only says that one is due.
 *
 * All of it is client-supplied, so it is validated like any other input: sizes
 * are capped, anything in `providerOptions` or a tool call's input must be
 * plain JSON, and the entries must follow each other the way a real exchange
 * does, which is also what providers require.
 */
import { z } from 'zod';

export const CONVERSATION_LIMITS = {
  /** Characters the model reads: text, reasoning, tool inputs and tool results. */
  chars: 120_000,
  entries: 160,
  partsPerMessage: 64,
  toolCallsPerMessage: 32,
  resultChars: 20_000,
  /** Serialized `providerOptions` on one message or part. */
  providerOptionsChars: 16_000,
  /** A tool call's input, serialized. */
  toolInputChars: 64_000,
  jsonDepth: 16,
} as const;

/** Why `value` is not plain JSON within the limits, or null when it is. */
function jsonProblem(value: unknown, maxChars: number): string | null {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) break;
    if (next.depth > CONVERSATION_LIMITS.jsonDepth) return 'is nested too deeply';
    const current = next.value;
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return 'is not plain JSON';
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) pending.push({ value: item, depth: next.depth + 1 });
      continue;
    }
    if (typeof current === 'object' && Object.getPrototypeOf(current) === Object.prototype) {
      for (const item of Object.values(current))
        pending.push({ value: item, depth: next.depth + 1 });
      continue;
    }
    return 'is not plain JSON';
  }
  return JSON.stringify(value).length > maxChars ? 'is too large' : null;
}

function plainJson<T extends z.ZodType>(schema: T, what: string, maxChars: number) {
  return schema.superRefine((value, context) => {
    const problem = jsonProblem(value, maxChars);
    // Not continuing: the checks on the whole conversation assume plain JSON.
    if (problem !== null) {
      context.addIssue({ code: 'custom', message: `${what} ${problem}.`, continue: false });
    }
  });
}

const providerOptionsSchema = plainJson(
  z.record(z.string().max(64), z.record(z.string().max(128), z.unknown())),
  'providerOptions',
  CONVERSATION_LIMITS.providerOptionsChars,
);

const toolCallIdSchema = z.string().min(1).max(128);
/** Any name the model used, including one that is not a tool: that call still needs an answer. */
const calledToolNameSchema = z.string().min(1).max(128);

const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  providerOptions: providerOptionsSchema.optional(),
});

const reasoningPartSchema = z.object({
  type: z.literal('reasoning'),
  text: z.string(),
  providerOptions: providerOptionsSchema.optional(),
});

const toolCallPartSchema = z.object({
  type: z.literal('tool-call'),
  toolCallId: toolCallIdSchema,
  toolName: calledToolNameSchema,
  /** As the model sent it: usually an object, a string when it was not valid JSON. */
  input: plainJson(z.unknown(), 'A tool call input', CONVERSATION_LIMITS.toolInputChars),
  providerOptions: providerOptionsSchema.optional(),
});

export const assistantMessageSchema = z.object({
  role: z.literal('assistant'),
  parts: z
    .array(z.discriminatedUnion('type', [textPartSchema, reasoningPartSchema, toolCallPartSchema]))
    .max(CONVERSATION_LIMITS.partsPerMessage),
  providerOptions: providerOptionsSchema.optional(),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type AssistantPart = AssistantMessage['parts'][number];
export type ToolCallPart = Extract<AssistantPart, { type: 'tool-call' }>;

export const toolResultSchema = z.object({
  toolCallId: toolCallIdSchema,
  toolName: calledToolNameSchema,
  isError: z.boolean(),
  output: z.string().max(CONVERSATION_LIMITS.resultChars),
});
export type ToolResult = z.infer<typeof toolResultSchema>;

const toolResultsEntrySchema = z.object({
  role: z.literal('tool'),
  results: z.array(toolResultSchema).min(1).max(CONVERSATION_LIMITS.toolCallsPerMessage),
});

const nudgeEntrySchema = z.object({ role: z.literal('nudge') });

const conversationEntrySchema = z.discriminatedUnion('role', [
  assistantMessageSchema,
  toolResultsEntrySchema,
  nudgeEntrySchema,
]);
export type ConversationEntry = z.infer<typeof conversationEntrySchema>;

export function toolCallsOf(message: AssistantMessage): ToolCallPart[] {
  return message.parts.filter((part): part is ToolCallPart => part.type === 'tool-call');
}

/** Characters the model reads, which is what the size cap counts. */
export function conversationChars(entries: readonly ConversationEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.role === 'assistant') {
      for (const part of entry.parts) {
        total += part.type === 'tool-call' ? JSON.stringify(part.input).length : part.text.length;
      }
    } else if (entry.role === 'tool') {
      for (const result of entry.results) total += result.output.length;
    }
  }
  return total;
}

/** How many model answers the conversation holds: one per step taken so far. */
export function conversationSteps(entries: readonly ConversationEntry[]): number {
  return entries.filter((entry) => entry.role === 'assistant').length;
}

type Turn =
  { kind: 'model' } | { kind: 'results'; calls: ReadonlyMap<string, string> } | { kind: 'nudge' };

/**
 * Why the entries do not follow each other the way a real exchange does, or
 * null when they do. The model answers first; an answer with tool calls is
 * followed by one result for each call, and an answer without is followed by a
 * nudge; and the conversation ends on the model's turn.
 */
function orderProblem(entries: readonly ConversationEntry[]): string | null {
  let turn: Turn = { kind: 'model' };
  for (const entry of entries) {
    switch (entry.role) {
      case 'assistant': {
        if (turn.kind !== 'model') return 'The conversation is out of order.';
        const calls = new Map(toolCallsOf(entry).map((call) => [call.toolCallId, call.toolName]));
        if (calls.size > CONVERSATION_LIMITS.toolCallsPerMessage) {
          return 'A model message has too many tool calls.';
        }
        if (calls.size !== toolCallsOf(entry).length) return 'Two tool calls share an id.';
        turn = calls.size > 0 ? { kind: 'results', calls } : { kind: 'nudge' };
        break;
      }
      case 'tool': {
        if (turn.kind !== 'results') return 'The conversation is out of order.';
        const answered = new Set<string>();
        for (const result of entry.results) {
          if (
            turn.calls.get(result.toolCallId) !== result.toolName ||
            answered.has(result.toolCallId)
          ) {
            return 'A tool result does not match a tool call.';
          }
          answered.add(result.toolCallId);
        }
        if (answered.size !== turn.calls.size) return 'A tool call has no result.';
        turn = { kind: 'model' };
        break;
      }
      case 'nudge':
        if (turn.kind !== 'nudge') return 'The conversation is out of order.';
        turn = { kind: 'model' };
        break;
    }
  }
  return turn.kind === 'model' ? null : 'The conversation ends before the model can answer.';
}

export const conversationSchema = z
  .array(conversationEntrySchema)
  .max(CONVERSATION_LIMITS.entries)
  .superRefine((entries, context) => {
    const problem = orderProblem(entries);
    if (problem !== null) context.addIssue({ code: 'custom', message: problem });
    if (conversationChars(entries) > CONVERSATION_LIMITS.chars) {
      context.addIssue({
        code: 'custom',
        message: `The conversation is too long for the AI (at most ${CONVERSATION_LIMITS.chars.toLocaleString('en-US')} characters).`,
      });
    }
  });
export type Conversation = z.infer<typeof conversationSchema>;
