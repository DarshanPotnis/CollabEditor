/**
 * The helper script under real Node, against a real HTTP server, exactly as
 * the container runs it: `node -e <script> <request> <nonce> <port>`.
 */
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  createNonce,
  encodeRequest,
  parseHelperOutput,
  responsePrefix,
  type ApiRequest,
  type ApiResult,
} from './request-codec.js';
import { REQUEST_SCRIPT } from './request-script.js';

let server: Server;
let port: number;
const leakedNonce = createNonce();

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      switch (request.url) {
        case '/users':
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify([{ id: 1, name: 'Ada Lovelace' }]));
          return;
        case '/echo':
          response.setHeader('content-type', 'application/json');
          response.setHeader('x-seen-header', request.headers['x-test'] ?? '');
          response.statusCode = 201;
          response.end(JSON.stringify({ method: request.method, body }));
          return;
        case '/spoof':
          // A hostile server: logs and a body full of framing lookalikes,
          // including a correctly prefixed line for a nonce it has seen.
          process.stdout.write(`${responsePrefix(leakedNonce)}e30=\n`);
          response.end(`\n${responsePrefix(leakedNonce)}eyJvayI6ZmFsc2V9\nCOLLABCODE-RESPONSE-\n`);
          return;
        case '/binary':
          response.setHeader('content-type', 'application/octet-stream');
          response.end(Buffer.from(Array.from({ length: 256 }, (_, index) => index)));
          return;
        case '/huge':
          response.end(Buffer.alloc(MAX_BODY_BYTES + 1_000, 0x61));
          return;
        case '/redirect':
          response.statusCode = 302;
          response.setHeader('location', '/users');
          response.end();
          return;
        default:
          response.statusCode = 404;
          response.end('Not found');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function runHelper(
  request: ApiRequest,
  nonce = createNonce(),
  targetPort = port,
): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['-e', REQUEST_SCRIPT, encodeRequest(request), nonce, String(targetPort)],
      { maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(new Error(`the helper failed: ${error.message}`));
        else resolve(parseHelperOutput(stdout, nonce));
      },
    );
  });
}

const get = (path: string): ApiRequest => ({ method: 'GET', path, headers: [], body: null });

function text(result: ApiResult): string {
  if (result.kind !== 'response')
    throw new Error(`expected a response, got ${JSON.stringify(result)}`);
  return new TextDecoder().decode(result.response.body);
}

describe('request helper script', () => {
  it('calls the server on localhost and returns status, headers, body and timing', async () => {
    const result = await runHelper(get('/users'));
    expect(result).toMatchObject({ kind: 'response', response: { status: 200, truncated: false } });
    if (result.kind !== 'response') return;
    expect(result.response.headers).toContainEqual(['content-type', 'application/json']);
    expect(result.response.ms).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(text(result))).toEqual([{ id: 1, name: 'Ada Lovelace' }]);
  });

  it('sends the method, headers and body', async () => {
    const result = await runHelper({
      method: 'POST',
      path: '/echo',
      headers: [
        ['content-type', 'application/json'],
        ['x-test', 'yes'],
      ],
      body: '{"name":"Grace"}',
    });
    expect(result).toMatchObject({ response: { status: 201 } });
    if (result.kind !== 'response') return;
    expect(result.response.headers).toContainEqual(['x-seen-header', 'yes']);
    expect(JSON.parse(text(result))).toEqual({ method: 'POST', body: '{"name":"Grace"}' });
  });

  it('cannot be spoofed by what the server logs or returns', async () => {
    const result = await runHelper(get('/spoof'), leakedNonce);
    expect(result.kind).toBe('response');
    expect(text(result)).toContain('eyJvayI6ZmFsc2V9');
  });

  it('returns a binary body intact', async () => {
    const result = await runHelper(get('/binary'));
    if (result.kind !== 'response') throw new Error(result.kind);
    expect([...result.response.body]).toEqual(Array.from({ length: 256 }, (_, index) => index));
  });

  it('cuts an oversized body and says so', async () => {
    const result = await runHelper(get('/huge'));
    if (result.kind !== 'response') throw new Error(result.kind);
    expect(result.response.truncated).toBe(true);
    expect(result.response.body.length).toBe(MAX_BODY_BYTES);
  });

  it('shows redirects instead of following them', async () => {
    const result = await runHelper(get('/redirect'));
    expect(result).toMatchObject({ response: { status: 302 } });
    if (result.kind === 'response')
      expect(result.response.headers).toContainEqual(['location', '/users']);
  });

  it('reports a server that is not listening as a failed request', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const result = await runHelper(get('/users'), createNonce(), closedPort);
    expect(result.kind).toBe('request-failed');
    if (result.kind === 'request-failed')
      expect(result.message).toMatch(/fetch failed|ECONNREFUSED/);
  });
});

describe('the script as an argument', () => {
  it('contains nothing a shell might interpret, since WebContainer spawn processes escapes', () => {
    expect(REQUEST_SCRIPT).not.toMatch(/[\\$`"]/);
  });
});
