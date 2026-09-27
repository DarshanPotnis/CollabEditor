import { tracingChannel } from 'node:diagnostics_channel';
import { Writable } from 'node:stream';
import { APICallError, streamText } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { Logger } from '../lib/logger.js';
import { createAiSdkGateway } from './ai-sdk-gateway.js';
import { ModelCallError, type ModelCall, type ModelEvent } from './model-gateway.js';

type StreamResult = Awaited<ReturnType<MockLanguageModelV4['doStream']>>;
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;
type StreamChunks = StreamPart[];

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 7, text: 7, reasoning: undefined },
};

function textStream(...deltas: string[]): StreamChunks {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    ...deltas.map((delta): StreamPart => ({ type: 'text-delta', id: 't', delta })),
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'STOP' }, usage },
  ];
}

function modelStreaming(chunks: StreamChunks): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: () => Promise.resolve({ stream: simulateReadableStream<StreamPart>({ chunks }) }),
  });
}

function call(signal = new AbortController().signal): ModelCall {
  return {
    target: { provider: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: 'test-key' },
    system: 'You explain code.',
    messages: [{ role: 'user', content: 'What does this do?' }],
    maxOutputTokens: 256,
    signal,
  };
}

function captureLogs(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: pino({ level: 'trace' }, stream), lines };
}

async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const seen: ModelEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

async function failureOf(events: AsyncIterable<ModelEvent>): Promise<ModelCallError> {
  try {
    await collect(events);
  } catch (error) {
    if (error instanceof ModelCallError) return error;
    throw new Error(`threw something other than a ModelCallError: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected the call to fail');
}

describe('the AI SDK gateway', () => {
  it('streams text deltas and ends with the finish reason and token usage', async () => {
    const model = modelStreaming(textStream('It logs ', '"hi".'));
    const gateway = createAiSdkGateway({
      logger: pino({ level: 'silent' }),
      createModel: () => model,
    });

    expect(await collect(gateway.stream(call()))).toEqual([
      { type: 'text-delta', text: 'It logs ' },
      { type: 'text-delta', text: '"hi".' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 120, outputTokens: 7 } },
    ]);
  });

  it('sends the system prompt, the messages and the output limit to the model', async () => {
    const model = modelStreaming(textStream('ok'));
    const gateway = createAiSdkGateway({
      logger: pino({ level: 'silent' }),
      createModel: () => model,
    });
    await collect(gateway.stream(call()));

    const [sent] = model.doStreamCalls;
    expect(sent?.maxOutputTokens).toBe(256);
    expect(sent?.prompt).toEqual([
      { role: 'system', content: 'You explain code.' },
      { role: 'user', content: [{ type: 'text', text: 'What does this do?' }] },
    ]);
  });

  it('builds the model for the call’s own target', async () => {
    const targets: unknown[] = [];
    const gateway = createAiSdkGateway({
      logger: pino({ level: 'silent' }),
      createModel: (target) => {
        targets.push(target);
        return modelStreaming(textStream('ok'));
      },
    });
    await collect(gateway.stream(call()));
    expect(targets).toEqual([call().target]);
  });

  it('does not retry a failed call, so one click spends one request', async () => {
    const model = new MockLanguageModelV4({
      doStream: () =>
        Promise.reject(
          new APICallError({
            message: 'overloaded',
            url: 'https://provider.example',
            requestBodyValues: {},
            statusCode: 503,
            isRetryable: true,
          }),
        ),
    });
    const gateway = createAiSdkGateway({
      logger: pino({ level: 'silent' }),
      createModel: () => model,
    });

    expect(await failureOf(gateway.stream(call()))).toMatchObject({
      failure: 'unavailable',
      statusCode: 503,
    });
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it('reports an error in the middle of a stream as a ModelCallError', async () => {
    const chunks: StreamChunks = [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Half an ans' },
      { type: 'error', error: new Error('connection reset') },
    ];
    const gateway = createAiSdkGateway({
      logger: pino({ level: 'silent' }),
      createModel: () => modelStreaming(chunks),
    });
    expect((await failureOf(gateway.stream(call()))).failure).toBe('unavailable');
  });

  it('stops and reports an abort when the signal fires mid-stream', async () => {
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream<StreamPart>({
            chunks: textStream('one ', 'two ', 'three'),
            chunkDelayInMs: 30,
          }),
        }),
    });
    const gateway = createAiSdkGateway({
      logger: pino({ level: 'silent' }),
      createModel: () => model,
    });

    const seen: ModelEvent[] = [];
    const failure = await (async () => {
      try {
        for await (const event of gateway.stream(call(controller.signal))) {
          seen.push(event);
          if (seen.length === 1) controller.abort();
        }
      } catch (error) {
        return error;
      }
      return null;
    })();

    expect(failure).toBeInstanceOf(ModelCallError);
    expect((failure as ModelCallError).failure).toBe('aborted');
    expect(seen.some((event) => event.type === 'finish')).toBe(false);
  });

  it('publishes nothing to the SDK telemetry channel', async () => {
    const channel = tracingChannel('ai:telemetry');
    let published = 0;
    const count = (): void => {
      published += 1;
    };
    const handlers = { start: count, end: count, asyncStart: count, asyncEnd: count, error: count };
    channel.subscribe(handlers);
    try {
      // A plain SDK call publishes, which shows this test can see the channel.
      const plain = streamText({ model: modelStreaming(textStream('ok')), prompt: 'hi' });
      for await (const _part of plain.fullStream);
      expect(published).toBeGreaterThan(0);

      published = 0;
      const gateway = createAiSdkGateway({
        logger: pino({ level: 'silent' }),
        createModel: () => modelStreaming(textStream('ok')),
      });
      await collect(gateway.stream(call()));
      expect(published).toBe(0);
    } finally {
      channel.unsubscribe(handlers);
    }
  });

  it('logs provider warnings through pino as types only', async () => {
    const chunks: StreamChunks = [
      {
        type: 'stream-start',
        warnings: [{ type: 'unsupported', feature: 'temperature', details: 'SECRET DETAIL' }],
      },
      ...textStream('ok').slice(1),
    ];
    const { logger, lines } = captureLogs();
    const gateway = createAiSdkGateway({ logger, createModel: () => modelStreaming(chunks) });
    await collect(gateway.stream(call()));

    const warning = lines.find((line) => line.includes('ai sdk warnings'));
    expect(warning).toBeDefined();
    expect(warning).toContain('"warnings":["unsupported"]');
    expect(lines.join('')).not.toContain('SECRET DETAIL');
  });
});
