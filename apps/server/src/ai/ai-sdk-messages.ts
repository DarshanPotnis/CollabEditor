/**
 * The agent's tools and conversation in the Vercel AI SDK's terms, and the
 * model's answer back in ours. Together with ai-sdk-gateway.ts, the only module
 * that imports the SDK (docs/decisions/007).
 *
 * - Tools are declared from the prompt's own definitions, with no `execute`:
 *   the SDK hands every call back, and the browser runs it.
 * - `providerOptions` are copied through untouched in both directions. Gemini's
 *   thought signatures travel there, and the Google provider quietly
 *   substitutes a placeholder for a missing one rather than failing, so a
 *   dropped signature would only show as a worse agent.
 */
import {
  assistantMessageSchema,
  declareTools,
  type AssistantMessage,
  type AssistantPart,
  type ConversationEntry,
  type ToolUse,
} from '@collabcode/shared';
import { jsonSchema, tool, type AssistantModelMessage, type ModelMessage, type ToolSet } from 'ai';

type SdkProviderOptions = NonNullable<AssistantModelMessage['providerOptions']>;
type SdkAssistantPart = Exclude<AssistantModelMessage['content'], string>[number];

export function toSdkTools(use: ToolUse): ToolSet {
  const tools: ToolSet = {};
  for (const declaration of declareTools(use.tools)) {
    tools[declaration.name] = tool({
      description: declaration.description,
      inputSchema: jsonSchema(declaration.inputSchema),
    });
  }
  return tools;
}

/** Validated as plain JSON by the conversation schema, which is all the SDK needs. */
function sdkOptions(options: Record<string, Record<string, unknown>>): SdkProviderOptions {
  return options as SdkProviderOptions;
}

function withOptions<Part extends object>(
  part: Part,
  options: Record<string, Record<string, unknown>> | undefined,
): Part & { providerOptions?: SdkProviderOptions } {
  return options === undefined ? part : { ...part, providerOptions: sdkOptions(options) };
}

function toSdkPart(part: AssistantPart): SdkAssistantPart {
  switch (part.type) {
    case 'text':
      return withOptions({ type: 'text', text: part.text }, part.providerOptions);
    case 'reasoning':
      return withOptions({ type: 'reasoning', text: part.text }, part.providerOptions);
    case 'tool-call':
      return withOptions(
        {
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        },
        part.providerOptions,
      );
  }
}

/** The conversation as SDK messages, to follow the prompt's own. */
export function toSdkMessages(
  conversation: readonly ConversationEntry[],
  nudge: string,
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const entry of conversation) {
    switch (entry.role) {
      case 'assistant':
        // Providers refuse an empty turn; one that said nothing is followed by a nudge anyway.
        if (entry.parts.length === 0) break;
        messages.push(
          withOptions(
            { role: 'assistant', content: entry.parts.map(toSdkPart) },
            entry.providerOptions,
          ),
        );
        break;
      case 'tool':
        messages.push({
          role: 'tool',
          content: entry.results.map((result) => ({
            type: 'tool-result',
            toolCallId: result.toolCallId,
            toolName: result.toolName,
            output: { type: result.isError ? 'error-text' : 'text', value: result.output },
          })),
        });
        break;
      case 'nudge':
        messages.push({ role: 'user', content: nudge });
        break;
    }
  }
  return messages;
}

function fromSdkPart(part: SdkAssistantPart): AssistantPart | null {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text, providerOptions: part.providerOptions };
    case 'reasoning':
      return { type: 'reasoning', text: part.text, providerOptions: part.providerOptions };
    case 'tool-call':
      return {
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerOptions: part.providerOptions,
      };
    default:
      // Files, custom parts and provider-executed results: none of our tools produce them.
      return null;
  }
}

/**
 * The model's message for this step, in our terms, or null when it cannot be
 * sent back in the next step (too large, or not plain JSON).
 */
export function fromSdkResponse(messages: readonly ModelMessage[]): AssistantMessage | null {
  const parts: AssistantPart[] = [];
  let providerOptions: SdkProviderOptions | undefined;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    providerOptions = message.providerOptions ?? providerOptions;
    const content =
      typeof message.content === 'string'
        ? [{ type: 'text' as const, text: message.content }]
        : message.content;
    for (const part of content) {
      const converted = fromSdkPart(part);
      if (converted) parts.push(converted);
    }
  }
  // A round trip through JSON drops undefined fields, as the wire will.
  const candidate: unknown = JSON.parse(
    JSON.stringify({ role: 'assistant', parts, providerOptions }),
  );
  const parsed = assistantMessageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
