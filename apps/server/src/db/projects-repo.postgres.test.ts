/**
 * The Postgres repo against a real database.
 *
 * Everything else in the suite uses the in-memory repo, which means the SQL,
 * the bytea round trip and the migration runner would otherwise be the one part
 * of the server nothing checks. CI provides a throwaway Postgres; locally this
 * file skips unless TEST_DATABASE_URL is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createProjectId,
  createProjectUpdate,
  readFileContent,
  readMeta,
} from '@collabcode/shared';
import { createSqlClient, type Sql } from './client.js';
import { createPostgresProjectsRepo, type ProjectsRepo } from './projects-repo.js';
import { runMigrations } from './migrate.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];

describe.skipIf(!databaseUrl)('createPostgresProjectsRepo', () => {
  let sql: Sql;
  let repo: ProjectsRepo;
  const created: string[] = [];

  beforeAll(async () => {
    // Checked by skipIf above; narrowing for TypeScript.
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
    sql = createSqlClient(databaseUrl);
    await runMigrations(sql, () => undefined);
    repo = createPostgresProjectsRepo(sql);
  });

  afterAll(async () => {
    if (created.length > 0) await sql`delete from projects where id in ${sql(created)}`;
    await sql.end();
  });

  async function seed(name = 'Postgres project'): Promise<{ id: string; entryFileId: string }> {
    const id = createProjectId();
    const { update, entryFileId } = createProjectUpdate({ name, template: 'express-api' });
    await repo.create({ id, name, template: 'express-api', ydoc: update });
    created.push(id);
    return { id, entryFileId };
  }

  it('applies migrations idempotently', async () => {
    expect(await runMigrations(sql, () => undefined)).toEqual([]);
  });

  it('creates a row and reads it back', async () => {
    const { id } = await seed('Readable');
    const record = await repo.findById(id);

    expect(record).toMatchObject({ id, name: 'Readable', template: 'express-api' });
    expect(record?.createdAt).toBeInstanceOf(Date);
    expect(record?.updatedAt).toBeInstanceOf(Date);
  });

  it('returns null for an unknown id rather than throwing', async () => {
    expect(await repo.findById(createProjectId())).toBeNull();
    expect(await repo.loadSnapshot(createProjectId())).toBeNull();
  });

  it('round-trips a Yjs snapshot through bytea', async () => {
    const { id, entryFileId } = await seed('Round trip');

    const snapshot = await repo.loadSnapshot(id);
    expect(snapshot).not.toBeNull();

    const restored = new Y.Doc();
    Y.applyUpdate(restored, snapshot ?? new Uint8Array());
    expect(readMeta(restored)).toMatchObject({ name: 'Round trip', template: 'express-api' });
    expect(readFileContent(restored, entryFileId)).toContain('A small Express API');
    restored.destroy();
  });

  it('overwrites the snapshot and moves updated_at forward', async () => {
    const { id, entryFileId } = await seed('Editable');
    const before = await repo.findById(id);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await repo.loadSnapshot(id)) ?? new Uint8Array());
    const text = doc.getMap<Y.Text>('contents').get(entryFileId);
    doc.transact(() => text?.insert(0, '// edited\n'), 'test');
    await repo.saveSnapshot(id, Y.encodeStateAsUpdate(doc));
    doc.destroy();

    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, (await repo.loadSnapshot(id)) ?? new Uint8Array());
    expect(readFileContent(reloaded, entryFileId)).toContain('// edited');
    reloaded.destroy();

    const after = await repo.findById(id);
    expect(after?.updatedAt.getTime()).toBeGreaterThanOrEqual(before?.updatedAt.getTime() ?? 0);
  });

  it('ignores a snapshot write for a project that does not exist', async () => {
    const id = createProjectId();
    await expect(repo.saveSnapshot(id, new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
    expect(await repo.findById(id)).toBeNull();
  });
});
