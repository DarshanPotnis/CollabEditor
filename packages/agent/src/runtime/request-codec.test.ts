import { describe, expect, it } from 'vitest';
import {
  encodeRequest,
  parseHelperOutput,
  responsePrefix,
  type ApiResult,
} from './request-codec.js';

const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** A line exactly as the helper script frames it. */
function frame(value: unknown, nonce = NONCE): string {
  return `${responsePrefix(nonce)}${Buffer.from(JSON.stringify(value), 'utf8').toString('base64')}`;
}

function ok(
  body: Uint8Array | string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: [['content-type', 'application/json']],
    body: bytes.toString('base64'),
    size: bytes.length,
    truncated: false,
    ms: 12.5,
    ...extra,
  };
}

function bodyText(result: ApiResult): string {
  if (result.kind !== 'response') throw new Error(`expected a response, got ${result.kind}`);
  return new TextDecoder().decode(result.response.body);
}

describe('parseHelperOutput', () => {
  it('reads the framed response, with the PTY carriage returns around it', () => {
    const result = parseHelperOutput(`\r\n${frame(ok('[{"id":1}]'))}\r\n`, NONCE);
    expect(result).toMatchObject({
      kind: 'response',
      response: {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'application/json']],
        ms: 12.5,
      },
    });
    expect(bodyText(result)).toBe('[{"id":1}]');
  });

  it('ignores anything else the process printed, such as a Node warning', () => {
    const output = `(node:42) ExperimentalWarning: something\r\nWarning\r\n${frame(ok('fine'))}\r\n`;
    expect(bodyText(parseHelperOutput(output, NONCE))).toBe('fine');
  });

  it('is not fooled by a body that contains marker-like text, even with the right nonce', () => {
    const hostile = `\n${responsePrefix(NONCE)}e30=\nCOLLABCODE-RESPONSE-:\n${frame(ok('fake'))}\n`;
    const result = parseHelperOutput(`${frame(ok(hostile))}\n`, NONCE);
    expect(bodyText(result)).toBe(hostile);
  });

  it('ignores a forged line carrying a different nonce', () => {
    const forged = frame(ok('forged'), 'ffffffffffffffffffffffffffffffff');
    expect(bodyText(parseHelperOutput(`${forged}\n${frame(ok('real'))}\n`, NONCE))).toBe('real');
  });

  it('rejects two lines with the right nonce instead of picking one', () => {
    const output = `${frame(ok('one'))}\n${frame(ok('two'))}\n`;
    expect(parseHelperOutput(output, NONCE)).toEqual({
      kind: 'invalid-output',
      message: 'The request helper printed more than one response, so neither is trusted.',
    });
  });

  it('carries binary bodies byte for byte', () => {
    const bytes = new Uint8Array(256).map((_, index) => index);
    const result = parseHelperOutput(frame(ok(bytes)), NONCE);
    if (result.kind !== 'response') throw new Error(result.kind);
    expect([...result.response.body]).toEqual([...bytes]);
  });

  it('passes on a request that failed', () => {
    const output = frame({ ok: false, error: 'fetch failed (connect ECONNREFUSED)', ms: 3 });
    expect(parseHelperOutput(output, NONCE)).toEqual({
      kind: 'request-failed',
      message: 'fetch failed (connect ECONNREFUSED)',
      ms: 3,
    });
  });

  it.each([
    ['nothing printed', ''],
    ['a line without the prefix', 'eyJvayI6dHJ1ZX0='],
    ['not base64', `${responsePrefix(NONCE)}not base64!`],
    [
      'base64 of something that is not JSON',
      `${responsePrefix(NONCE)}${Buffer.from('<html>').toString('base64')}`,
    ],
    ['JSON of the wrong shape', frame({ ok: true, status: 'teapot' })],
    ['a status out of range', frame(ok('x', { status: 4040 }))],
    ['headers that are not pairs', frame(ok('x', { headers: [['only-a-name']] }))],
    ['a body that is not base64', frame(ok('x', { body: '%%%' }))],
  ])('refuses %s', (_label, output) => {
    expect(parseHelperOutput(output, NONCE).kind).toBe('invalid-output');
  });
});

describe('encodeRequest', () => {
  it('produces a single base64 argument, whatever the body contains', () => {
    const encoded = encodeRequest({
      method: 'POST',
      path: '/users',
      headers: [['content-type', 'application/json']],
      body: '{"name":"Ada\n\u0000 é 😀"}',
    });
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))).toMatchObject({
      body: '{"name":"Ada\n\u0000 é 😀"}',
    });
  });
});
