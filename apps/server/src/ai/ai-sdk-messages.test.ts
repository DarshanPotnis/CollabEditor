/**
 * The agent's side of the gateway: tools declared from the prompt, the
 * conversation sent after the prompt's messages, and the model's whole message
 * coming back, with its providerOptions, ready for the next step.
 */
import { Writable } from 'node:stream';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  AGENT_TOOL_NAMES,
  PROMPTS,
  conversationSchema,
  type AssistantMessage,
  type ConversationEntry,
  type ToolUse,
} from '@collabcode/shared';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createAiSdkGateway } from './ai-sdk-gateway.js';
import {
  ModelCallError,
  type ModelCall,
  type ModelEvent,
  type ModelTarget,
} from './model-gateway.js';

type StreamResult = Awaited<ReturnType<MockLanguageModelV4['doStream']>>;
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;

const usage = {
  inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const agent = PROMPTS.agent;

function agentToolUse(): ToolUse {
  if (!agent.toolUse) throw new Error('the agent prompt declares its tools');
  return agent.toolUse;
}
const toolUse = agentToolUse();

function agentCall(conversation: ConversationEntry[], target?: ModelTarget): ModelCall {
  const prepared = agent.prepare({ goal: 'Add a DELETE route', files: ['routes/users.js'] });
  if (!prepared.ok) throw new Error(prepared.message);
  return {
    target: target ?? { provider: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: 'test-key' },
    system: prepared.prompt.system,
    messages: prepared.prompt.messages,
    maxOutputTokens: agent.maxOutputTokens,
    toolUse: { use: toolUse, conversation },
    signal: new AbortController().signal,
  };
}

function modelStreaming(parts: StreamPart[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream<StreamPart>({
          chunks: [
            { type: 'stream-start', warnings: [] },
            ...parts,
            { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'STOP' }, usage },
          ],
        }),
      }),
  });
}

function toolCallPart(toolName: string, input: unknown, signature?: string): StreamPart {
  return {
    type: 'tool-call',
    toolCallId: `id-${toolName}`,
    toolName,
    input: JSON.stringify(input),
    ...(signature === undefined && { providerMetadata: undefined }),
    ...(signature !== undefined && {
      providerMetadata: { google: { thoughtSignature: signature } },
    }),
  };
}

async function finishOf(
  events: AsyncIterable<ModelEvent>,
): Promise<Extract<ModelEvent, { type: 'finish' }>> {
  let finish: ModelEvent | undefined;
  for await (const event of events) finish = event;
  if (finish?.type !== 'finish') throw new Error('expected a finish event');
  return finish;
}

function silentGateway(model: MockLanguageModelV4) {
  return createAiSdkGateway({ logger: pino({ level: 'silent' }), createModel: () => model });
}

describe('an agent step', () => {
  it("declares the prompt's thirteen tools and requires a tool call", async () => {
    const model = modelStreaming([toolCallPart('list_files', {})]);
    await finishOf(silentGateway(model).stream(agentCall([])));

    const [sent] = model.doStreamCalls;
    expect(sent?.tools?.map((tool) => tool.name)).toEqual(AGENT_TOOL_NAMES);
    expect(sent?.tools?.[0]).toMatchObject({ type: 'function', inputSchema: { type: 'object' } });
    expect(sent?.toolChoice).toEqual({ type: 'required' });
  });

  it('sends the conversation after the prompt, with tool results and the nudge in words', async () => {
    const conversation = conversationSchema.parse([
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'read_file',
            input: { path: 'a.js' },
            providerOptions: { google: { thoughtSignature: 'sig-1' } },
          },
          { type: 'tool-call', toolCallId: 'c2', toolName: 'read_file', input: { path: 'b.js' } },
        ],
      },
      {
        role: 'tool',
        results: [
          { toolCallId: 'c1', toolName: 'read_file', isError: false, output: '1| a' },
          { toolCallId: 'c2', toolName: 'read_file', isError: true, output: 'No file b.js.' },
        ],
      },
      { role: 'assistant', parts: [{ type: 'text', text: 'Thinking out loud.' }] },
      { role: 'nudge' },
    ]);
    const model = modelStreaming([toolCallPart('finish', { summary: 'ok' })]);
    await finishOf(silentGateway(model).stream(agentCall(conversation)));

    const prompt = model.doStreamCalls[0]?.prompt ?? [];
    expect(prompt.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);
    expect(prompt[2]?.content).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'c1',
        input: { path: 'a.js' },
        providerOptions: { google: { thoughtSignature: 'sig-1' } },
      }),
      expect.objectContaining({ type: 'tool-call', toolCallId: 'c2' }),
    ]);
    expect(prompt[3]?.content).toEqual([
      expect.objectContaining({ toolCallId: 'c1', output: { type: 'text', value: '1| a' } }),
      expect.objectContaining({
        toolCallId: 'c2',
        output: { type: 'error-text', value: 'No file b.js.' },
      }),
    ]);
    expect(prompt[5]?.content).toEqual([{ type: 'text', text: toolUse.nudge }]);
  });

  it("ends with the model's whole message, providerOptions included", async () => {
    const model = modelStreaming([
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Let me look.' },
      { type: 'text-end', id: 't' },
      toolCallPart('read_file', { path: 'routes/users.js' }, 'sig-2'),
    ]);
    const finish = await finishOf(silentGateway(model).stream(agentCall([])));

    expect(finish.finishReason).toBe('tool-calls');
    expect(finish.message).toEqual<AssistantMessage>({
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Let me look.' },
        {
          type: 'tool-call',
          toolCallId: 'id-read_file',
          toolName: 'read_file',
          input: { path: 'routes/users.js' },
          providerOptions: { google: { thoughtSignature: 'sig-2' } },
        },
      ],
    });
  });

  it('keeps a call to a tool that does not exist, so it can be answered with an error', async () => {
    const model = modelStreaming([toolCallPart('delete_everything', { really: true })]);
    const finish = await finishOf(silentGateway(model).stream(agentCall([])));
    expect(finish.message?.parts).toEqual([
      expect.objectContaining({ type: 'tool-call', toolName: 'delete_everything' }),
    ]);
  });

  it('fails as oversized when the message could not be sent back', async () => {
    const model = modelStreaming([
      toolCallPart('create_file', { path: 'a.js', content: 'x'.repeat(70_000) }),
    ]);
    const events = silentGateway(model).stream(agentCall([]));
    await expect(finishOf(events)).rejects.toEqual(new ModelCallError('oversized'));
  });

  it('sends no tools and no conversation for a one-shot prompt', async () => {
    const model = modelStreaming([
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'An answer.' },
      { type: 'text-end', id: 't' },
    ]);
    const { toolUse: _unused, ...oneShot } = agentCall([]);
    const finish = await finishOf(silentGateway(model).stream(oneShot));
    expect(model.doStreamCalls[0]?.tools).toBeUndefined();
    expect(finish.message).toBeUndefined();
  });
});

describe('a Gemini thought signature', () => {
  /** Answers Gemini's streaming endpoint with canned server-sent events, and records each request body. */
  function fakeGemini(replies: object[][]): { fetch: typeof fetch; bodies: unknown[] } {
    const bodies: unknown[] = [];
    let turn = 0;
    const fakeFetch: typeof fetch = (_input, init) => {
      bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : 'null'));
      const events = replies[turn] ?? [];
      turn += 1;
      const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    };
    return { fetch: fakeFetch, bodies };
  }

  function candidate(parts: object[]): object {
    return {
      candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 8, totalTokenCount: 58 },
    };
  }

  it('survives a round trip through the browser and back to Gemini unchanged', async () => {
    const signature = 'U2lnbmF0dXJlT2ZUaGVUaG91Z2h0';
    const gemini = fakeGemini([
      [
        candidate([
          {
            functionCall: { name: 'read_file', args: { path: 'routes/users.js' } },
            thoughtSignature: signature,
          },
        ]),
      ],
      [candidate([{ functionCall: { name: 'finish', args: { summary: 'Done.' } } }])],
    ]);
    const lines: string[] = [];
    const logger = pino(
      { level: 'trace' },
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString());
          done();
        },
      }),
    );
    const gateway = createAiSdkGateway({
      logger,
      createModel: (target) =>
        createGoogleGenerativeAI({ apiKey: target.apiKey, fetch: gemini.fetch })(target.model),
    });

    const first = await finishOf(gateway.stream(agentCall([])));
    // What the browser receives, keeps and sends back: JSON, validated on the way in.
    const message: unknown = JSON.parse(JSON.stringify(first.message));
    const call = first.message?.parts.find((part) => part.type === 'tool-call');
    if (call?.type !== 'tool-call') throw new Error('expected a tool call');
    const conversation = conversationSchema.parse([
      message,
      {
        role: 'tool',
        results: [
          { toolCallId: call.toolCallId, toolName: 'read_file', isError: false, output: '1| x' },
        ],
      },
    ]);
    await finishOf(gateway.stream(agentCall(conversation)));

    const second = JSON.stringify(gemini.bodies[1]);
    expect(second).toContain(`"thoughtSignature":"${signature}"`);
    expect(second).not.toContain('skip_thought_signature_validator');
    expect(lines.join('')).not.toContain('ai sdk warnings');
    const declared = JSON.stringify(gemini.bodies[0]);
    expect(declared).toContain('"functionDeclarations"');
    expect(declared).toContain('"mode":"ANY"');
  });
});
