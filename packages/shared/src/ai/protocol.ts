/**
 * The contract for POST /api/ai/step (docs/PLAN-AI.md §6), shared by the
 * server, which validates requests and writes the stream, and the browser,
 * which builds requests and validates every event it reads.
 *
 * A request names a server-owned prompt and carries its inputs; there is no
 * field for a system prompt or for tools. The agent's requests also carry the
 * conversation so far (conversation.ts), which only a prompt with tools
 * accepts. A caller's own provider key travels only in the AI_KEY_HEADER
 * header, never in the body, which is what an agent's trace records.
 *
 * The response is a stream of `data: <json>` lines (server-sent events format),
 * one AiStreamEvent each, ending with exactly one `finish` or `error` event.
 * Failures before the model's first event are plain HTTP errors instead. For a
 * prompt with tools, `finish` carries the model's whole message, tool calls
 * included, to be sent back unchanged in the next step's conversation.
 */
import { z } from 'zod';
import { apiErrorSchema, projectIdSchema } from '../protocol.js';
import { assistantMessageSchema, conversationSchema } from './conversation.js';
import { PROMPT_IDS } from './prompts/index.js';

export const AI_STEP_PATH = '/api/ai/step';

/** Carries a caller's own provider key. Never logged and never in a body. */
export const AI_KEY_HEADER = 'x-ai-key';

export const AI_PROVIDERS = ['gemini', 'anthropic', 'openai'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Readonly<Record<AiProvider, string>> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

/**
 * Models a caller may choose with their own key; the first is the default.
 * Each id appears in the model list of the provider package the server uses.
 */
export const BYOK_MODELS = {
  gemini: ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro-preview'],
  anthropic: ['claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-5-5'],
  openai: ['gpt-5.5', 'gpt-5.4-mini', 'gpt-5.6'],
} as const satisfies Record<AiProvider, readonly [string, ...string[]]>;

export const byokChoiceSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('gemini'), model: z.enum(BYOK_MODELS.gemini) }),
  z.object({ provider: z.literal('anthropic'), model: z.enum(BYOK_MODELS.anthropic) }),
  z.object({ provider: z.literal('openai'), model: z.enum(BYOK_MODELS.openai) }),
]);
export type ByokChoice = z.infer<typeof byokChoiceSchema>;

/**
 * The shape of a provider key: printable ASCII with no spaces. Deliberately
 * loose about length and prefix, which differ by provider and change.
 */
export const aiKeySchema = z
  .string()
  .trim()
  .min(8, "That doesn't look like an API key.")
  .max(512, "That doesn't look like an API key.")
  .regex(/^[\x21-\x7e]+$/, "That doesn't look like an API key.");

export const aiStepRequestSchema = z.object({
  projectId: projectIdSchema,
  promptId: z.enum(PROMPT_IDS, { error: 'Unknown AI prompt.' }),
  /** Validated by the named prompt's own schema. */
  inputs: z.unknown(),
  /** The agent's conversation so far; refused for a prompt without tools. */
  conversation: conversationSchema.optional(),
  /**
   * An agent session on the shared tier: the model its first step's `finish`
   * named. Later steps must stay on it, since the conversation carries that
   * model's thought signatures. The server accepts only its own shared models.
   */
  sharedModel: z
    .string()
    .regex(/^gemini-[a-z0-9.-]{1,60}$/)
    .optional(),
  /** Groups an agent session's steps in the server log. Chosen by the client, so only a label. */
  sessionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  /** Present exactly when the AI_KEY_HEADER carries the caller's own key. */
  byok: byokChoiceSchema.optional(),
});
export type AiStepRequest = z.infer<typeof aiStepRequestSchema>;

export const AI_FINISH_REASONS = [
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
] as const;
export type AiFinishReason = (typeof AI_FINISH_REASONS)[number];

const tokenCountSchema = z.number().int().nonnegative().nullable();

export const aiStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text-delta'), text: z.string() }),
  z.object({
    type: z.literal('finish'),
    finishReason: z.enum(AI_FINISH_REASONS),
    usage: z.object({ inputTokens: tokenCountSchema, outputTokens: tokenCountSchema }),
    prompt: z.object({ id: z.enum(PROMPT_IDS), version: z.number().int().positive() }),
    model: z.object({ provider: z.enum(AI_PROVIDERS), id: z.string().min(1) }),
    /** Shared-tier requests this caller has left today; null with their own key. */
    remainingToday: z.number().int().nonnegative().nullable(),
    /** For a prompt with tools: the model's whole message, to send back unchanged. */
    message: assistantMessageSchema.optional(),
  }),
  z.object({ type: z.literal('error'), error: apiErrorSchema.shape.error }),
]);
export type AiStreamEvent = z.infer<typeof aiStreamEventSchema>;
