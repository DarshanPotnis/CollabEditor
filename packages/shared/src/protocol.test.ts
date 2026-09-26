import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  createProjectBodySchema,
  healthResponseSchema,
  projectIdSchema,
  projectSummarySchema,
} from './protocol.js';
import { MAX_PROJECT_NAME_LENGTH } from './limits.js';
import { createProjectId } from './ids.js';

describe('projectIdSchema', () => {
  it('accepts generated ids', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(projectIdSchema.safeParse(createProjectId()).success).toBe(true);
    }
  });

  it.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['uppercase', 'ABCDEFGH'],
    ['path traversal', '../../etc'],
    ['sql-ish', "abc'; drop table projects;--"],
    ['too long', 'a'.repeat(33)],
  ])('rejects %s', (_label, value) => {
    expect(projectIdSchema.safeParse(value).success).toBe(false);
  });
});

describe('createProjectBodySchema', () => {
  it('accepts a template on its own', () => {
    expect(createProjectBodySchema.parse({ template: 'blank-node' })).toEqual({
      template: 'blank-node',
    });
  });

  it('trims a name', () => {
    expect(createProjectBodySchema.parse({ template: 'blank-node', name: '  Demo  ' })).toEqual({
      template: 'blank-node',
      name: 'Demo',
    });
  });

  it.each([
    ['unknown template', { template: 'rails' }],
    ['missing template', { name: 'Demo' }],
    ['blank name', { template: 'blank-node', name: '   ' }],
    ['over-long name', { template: 'blank-node', name: 'a'.repeat(MAX_PROJECT_NAME_LENGTH + 1) }],
    ['name is not a string', { template: 'blank-node', name: 42 }],
    ['not an object', 'blank-node'],
  ])('rejects %s', (_label, body) => {
    expect(createProjectBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('response schemas', () => {
  it('validates a project summary', () => {
    const summary = {
      id: createProjectId(),
      name: 'Demo',
      template: 'blank-node',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(projectSummarySchema.parse(summary)).toEqual(summary);
  });

  it('validates health and error payloads', () => {
    expect(healthResponseSchema.parse({ ok: true, uptimeSeconds: 1.5 }).ok).toBe(true);
    expect(healthResponseSchema.safeParse({ ok: false, uptimeSeconds: 1 }).success).toBe(false);
    expect(apiErrorSchema.parse({ error: { code: 'not-found', message: 'no' } }).error.code).toBe(
      'not-found',
    );
    expect(apiErrorSchema.safeParse({ error: { code: 'teapot', message: 'no' } }).success).toBe(
      false,
    );
  });
});
