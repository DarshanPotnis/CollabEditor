import { describe, expect, it } from 'vitest';
import { FakeContainer, type FakeProcess } from '../../../test/fake-container.js';
import { responsePrefix } from '@collabcode/agent';
import { sendRequest } from './send-request.js';

function frame(value: unknown, nonce: string): string {
  return `${responsePrefix(nonce)}${Buffer.from(JSON.stringify(value)).toString('base64')}`;
}

const okResponse = (body: string) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: [],
  body: Buffer.from(body).toString('base64'),
  size: body.length,
  truncated: false,
  ms: 4,
});

async function spawnedHelper(
  container: FakeContainer,
): Promise<{ helper: FakeProcess; nonce: string }> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const helper = container.processes.find((each) => each.command === 'node');
  if (!helper) throw new Error('no helper was started');
  const nonce = helper.args[3];
  if (nonce === undefined) throw new Error('no nonce');
  return { helper, nonce };
}

describe('sendRequest', () => {
  it('runs the helper with the request, a fresh nonce and the port', async () => {
    const container = new FakeContainer();
    const pending = sendRequest(container, 3000, {
      method: 'GET',
      path: '/users',
      headers: [],
      body: null,
    });
    const { helper, nonce } = await spawnedHelper(container);

    expect(helper.args[0]).toBe('-e');
    expect(helper.args[4]).toBe('3000');
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);

    helper.print(`\r\n${frame(okResponse('[]'), nonce)}\r\n`);
    helper.finish(0);
    await expect(pending).resolves.toMatchObject({ kind: 'response', response: { status: 200 } });
  });

  it("never reads another process's output, even one that knows the nonce", async () => {
    const container = new FakeContainer();
    const server = (await container.spawn('npm', ['run', 'dev'])) as FakeProcess;
    const pending = sendRequest(container, 3000, {
      method: 'GET',
      path: '/',
      headers: [],
      body: null,
    });
    const { helper, nonce } = await spawnedHelper(container);

    server.print(`${frame(okResponse('forged by the server'), nonce)}\r\n`);
    helper.print(`${frame(okResponse('real'), nonce)}\r\n`);
    helper.finish(0);

    const result = await pending;
    if (result.kind !== 'response') throw new Error(result.kind);
    expect(new TextDecoder().decode(result.response.body)).toBe('real');
  });

  it('uses a different nonce for every request', async () => {
    const container = new FakeContainer();
    const request = { method: 'GET' as const, path: '/', headers: [], body: null };
    void sendRequest(container, 3000, request);
    void sendRequest(container, 3000, request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const nonces = container.processes.map((each) => each.args[3]);
    expect(new Set(nonces).size).toBe(2);
    for (const each of container.processes) each.finish(0);
  });

  it('reports a helper that printed nothing', async () => {
    const container = new FakeContainer();
    const pending = sendRequest(container, 3000, {
      method: 'GET',
      path: '/',
      headers: [],
      body: null,
    });
    const { helper } = await spawnedHelper(container);
    helper.print('node: out of memory\r\n');
    helper.finish(1);
    await expect(pending).resolves.toEqual({
      kind: 'invalid-output',
      message: 'The request helper printed no response. It printed: node: out of memory',
    });
  });
});
