/**
 * Server-owned prompts (docs/PLAN-AI.md §6.4). A client names a prompt and
 * sends its inputs; only the server turns them into the text a model sees. That
 * keeps the shared key from being a general-purpose relay, and means the
 * deployed app and the evals run exactly the same prompt versions.
 *
 * Bump `version` whenever `build` would produce different text or the input
 * schema changes. prompts/prompts.test.ts fingerprints every prompt, so a
 * change without a bump fails the build.
 */
import type { z } from 'zod';

export type PromptMessage = { role: 'user' | 'assistant'; content: string };

/** What a model is sent: a fixed system prompt, and messages carrying the inputs. */
export type BuiltPrompt = { system: string; messages: PromptMessage[] };

export type PromptDefinition<Id extends string, Schema extends z.ZodType> = {
  id: Id;
  version: number;
  /** Validates, and caps the size of, everything the client controls. */
  inputs: Schema;
  /** Upper bound on the answer, including thinking for models that think. */
  maxOutputTokens: number;
  build: (inputs: z.output<Schema>) => BuiltPrompt;
};

export type PreparedPrompt = { ok: true; prompt: BuiltPrompt } | { ok: false; message: string };

export type RegisteredPrompt<Id extends string, Schema extends z.ZodType> = PromptDefinition<
  Id,
  Schema
> & {
  /** Validates untrusted inputs and builds the prompt, or says what was wrong. */
  prepare: (inputs: unknown) => PreparedPrompt;
};

/** What a client must send as `inputs` for a prompt. */
export type PromptInputs<Prompt> =
  Prompt extends PromptDefinition<string, infer Schema> ? z.input<Schema> : never;

export function definePrompt<const Id extends string, Schema extends z.ZodType>(
  definition: PromptDefinition<Id, Schema>,
): RegisteredPrompt<Id, Schema> {
  return {
    ...definition,
    prepare(inputs) {
      const parsed = definition.inputs.safeParse(inputs);
      if (!parsed.success) {
        return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid prompt inputs.' };
      }
      return { ok: true, prompt: definition.build(parsed.data) };
    },
  };
}
