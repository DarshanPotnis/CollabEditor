/**
 * Server-owned prompts (docs/PLAN-AI.md §6.4). A client names a prompt and
 * sends its inputs; only the server turns them into the text a model sees. That
 * keeps the shared key from being a general-purpose relay, and means the
 * deployed app and the evals run exactly the same prompt versions.
 *
 * A prompt may also own tools the model can call (the AI agent's). Only such a
 * prompt accepts a conversation, and the tools come from the definition, never
 * from the request, so a client cannot hand the model tools of its own.
 *
 * Bump `version` whenever `build` would produce different text, the input
 * schema changes, or the tools do. prompts/prompt-versions.test.ts fingerprints
 * every prompt, so a change without a bump fails the build.
 */
import { z } from 'zod';

export type PromptMessage = { role: 'user' | 'assistant'; content: string };

/** What a model is sent: a fixed system prompt, and messages carrying the inputs. */
export type BuiltPrompt = { system: string; messages: PromptMessage[] };

/** A tool the model may call: what it is for, and the shape of its input. */
export type ToolDefinition = { description: string; input: z.ZodObject };

export type ToolSet = Readonly<Record<string, ToolDefinition>>;

/** How a tool is declared to a model: its input as JSON Schema. */
export type ToolDeclaration = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/** What a prompt that works with tools declares. */
export type ToolUse = {
  tools: ToolSet;
  /** 'required' makes every answer call at least one tool. */
  toolChoice: 'auto' | 'required';
  /** Said to the model when it answered without calling a tool. */
  nudge: string;
};

export type PromptDefinition<Id extends string, Schema extends z.ZodType> = {
  id: Id;
  version: number;
  /** Validates, and caps the size of, everything the client controls. */
  inputs: Schema;
  /** Upper bound on the answer, including thinking for models that think. */
  maxOutputTokens: number;
  build: (inputs: z.output<Schema>) => BuiltPrompt;
  /** Present only for a prompt that works with tools, over a conversation. */
  toolUse?: ToolUse;
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

/** Tools as a model sees them, in a fixed order. */
export function declareTools(tools: ToolSet): ToolDeclaration[] {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
  }));
}

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
