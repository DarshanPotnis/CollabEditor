import { describe, expect, it } from 'vitest';
import { composeToolHost, type RuntimeToolCall } from './compose-tool-host.js';
import type { DocToolCall } from './doc-tools/file-tools.js';
import { neverStopped } from './test/support.js';

describe('composeToolHost', () => {
  it('sends file tools to the document and the rest to the runtime', async () => {
    const seen: string[] = [];
    const host = composeToolHost(
      {
        execute: (call: DocToolCall) => {
          seen.push(`doc:${call.name}`);
          return Promise.resolve({ ok: true, output: '' });
        },
      },
      {
        execute: (call: RuntimeToolCall) => {
          seen.push(`runtime:${call.name}`);
          return Promise.resolve({ ok: true, output: '' });
        },
      },
    );
    await host.execute({ name: 'read_file', input: { path: 'a.js' } }, neverStopped);
    await host.execute({ name: 'run_project', input: {} }, neverStopped);
    await host.execute({ name: 'delete_file', input: { path: 'a.js' } }, neverStopped);
    await host.execute({ name: 'http_request', input: { method: 'GET', path: '/' } }, neverStopped);
    expect(seen).toEqual([
      'doc:read_file',
      'runtime:run_project',
      'doc:delete_file',
      'runtime:http_request',
    ]);
  });
});
