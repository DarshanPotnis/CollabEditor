/**
 * Integration tests for the Express app *as mounted inside the Hocuspocus HTTP
 * server*. Every request here goes through the real onRequest hook, so these
 * tests would fail if the mount broke, not just if a route broke.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { projectIdSchema, projectSummarySchema, readMeta } from '@collabcode/shared';
import { startTestServer, type TestServer } from '../collab/test-server.js';
import { seedProject } from '../test/support.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const OTHER_ALLOWED_ORIGIN = 'https://collabcode.example';
const DISALLOWED_ORIGIN = 'https://evil.example';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({ allowedOrigins: [ALLOWED_ORIGIN, OTHER_ALLOWED_ORIGIN] });
});

afterAll(async () => {
  await server.stop();
});

describe('GET /health', () => {
  it('answers without touching the database', async () => {
    const response = await fetch(`${server.httpUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it('proves Express owns the routing, not Hocuspocus', async () => {
    const response = await fetch(`${server.httpUrl}/`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Hocuspocus');
  });
});

describe('POST /api/projects', () => {
  it('creates a project from a JSON body and stores its initial document', async () => {
    const response = await fetch(`${server.httpUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My workspace', template: 'express-api' }),
    });

    expect(response.status).toBe(201);
    const summary = projectSummarySchema.parse(await response.json());
    expect(summary).toMatchObject({ name: 'My workspace', template: 'express-api' });
    expect(projectIdSchema.safeParse(summary.id).success).toBe(true);

    const snapshot = await server.repo.loadSnapshot(summary.id);
    expect(snapshot).not.toBeNull();

    const stored = new Y.Doc();
    Y.applyUpdate(stored, snapshot ?? new Uint8Array());
    expect(readMeta(stored)).toMatchObject({ name: 'My workspace', template: 'express-api' });
    expect(stored.getMap('nodes').size).toBe(1);
    stored.destroy();
  });

  it('falls back to the template label when no name is given', async () => {
    const response = await fetch(`${server.httpUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template: 'blank-node' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: 'Blank Node' });
  });

  it.each([
    ['an unknown template', { template: 'rails' }],
    ['no template', { name: 'Nameless' }],
    ['a blank name', { template: 'blank-node', name: '   ' }],
  ])('rejects %s with 400', async (_label, body) => {
    const response = await fetch(`${server.httpUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'bad-request' } });
  });

  it('rejects a malformed JSON body with 400 rather than 500', async () => {
    const response = await fetch(`${server.httpUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'bad-request' } });
  });

  it('accepts a request from an allowed origin and echoes it back', async () => {
    const response = await fetch(`${server.httpUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ template: 'blank-node' }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
  });
});

describe('GET /api/projects/:id', () => {
  it('returns a project that exists', async () => {
    const project = await seedProject(server.repo, 'Lookup me');
    const response = await fetch(`${server.httpUrl}/api/projects/${project.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: project.id, name: 'Lookup me' });
  });

  it.each([
    ['an unknown id', 'zzzzzzzzzzzz'],
    ['a malformed id', 'NOPE'],
    ['a traversal attempt', '..%2F..%2Fetc%2Fpasswd'],
  ])('returns 404 for %s', async (_label, id) => {
    const response = await fetch(`${server.httpUrl}/api/projects/${id}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not-found' } });
  });
});

describe('rate limiting', () => {
  it('refuses a flood of project creations from one IP with our error shape', async () => {
    const limited = await startTestServer({ projectCreateLimitPerMinute: 2 });
    try {
      const create = (): Promise<Response> =>
        fetch(`${limited.httpUrl}/api/projects`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ template: 'blank-node' }),
        });

      expect((await create()).status).toBe(201);
      expect((await create()).status).toBe(201);

      const refused = await create();
      expect(refused.status).toBe(429);
      expect(await refused.json()).toMatchObject({ error: { code: 'rate-limited' } });
      expect(limited.repo.size).toBe(2);
    } finally {
      await limited.stop();
    }
  });
});

describe('CORS', () => {
  it('answers a preflight from an allowed origin', async () => {
    const response = await fetch(`${server.httpUrl}/api/projects`, {
      method: 'OPTIONS',
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-max-age')).toBe('600');
  });

  it('answers a preflight for each allowed origin, without a wildcard', async () => {
    const response = await fetch(`${server.httpUrl}/api/projects`, {
      method: 'OPTIONS',
      headers: { origin: OTHER_ALLOWED_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe(OTHER_ALLOWED_ORIGIN);
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('rejects a preflight from a disallowed origin and sends no CORS headers', async () => {
    const response = await fetch(`${server.httpUrl}/api/projects`, {
      method: 'OPTIONS',
      headers: {
        origin: DISALLOWED_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('rejects a real request from a disallowed origin before it reaches a route', async () => {
    const before = server.repo.size;
    const response = await fetch(`${server.httpUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: DISALLOWED_ORIGIN },
      body: JSON.stringify({ template: 'blank-node' }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(server.repo.size).toBe(before);
  });

  it('leaves requests without an Origin header alone', async () => {
    const response = await fetch(`${server.httpUrl}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
