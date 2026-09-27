/**
 * Everything the rest of the server knows about storage.
 *
 * Brute force on purpose: a project's whole Y.Doc is stored as one snapshot
 * and rewritten on each debounced save. The optimisation (append-only updates
 * with periodic compaction) is recorded in docs/decisions/002 and not built.
 */
import type { Sql } from './client.js';

export type ProjectRecord = {
  id: string;
  name: string;
  template: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateProjectInput = {
  id: string;
  name: string;
  template: string;
  ydoc: Uint8Array;
};

export interface ProjectsRepo {
  create(input: CreateProjectInput): Promise<ProjectRecord>;
  findById(id: string): Promise<ProjectRecord | null>;
  loadSnapshot(id: string): Promise<Uint8Array | null>;
  saveSnapshot(id: string, ydoc: Uint8Array): Promise<void>;
}

type ProjectRow = {
  id: string;
  name: string;
  template: string;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPostgresProjectsRepo(sql: Sql): ProjectsRepo {
  return {
    async create(input) {
      const rows = await sql<ProjectRow[]>`
        insert into projects (id, name, template, ydoc)
        values (${input.id}, ${input.name}, ${input.template}, ${Buffer.from(input.ydoc)})
        returning id, name, template, created_at, updated_at
      `;
      const row = rows[0];
      if (!row) throw new Error(`insert of project ${input.id} returned no row`);
      return toRecord(row);
    },

    async findById(id) {
      const rows = await sql<ProjectRow[]>`
        select id, name, template, created_at, updated_at from projects where id = ${id}
      `;
      const row = rows[0];
      return row ? toRecord(row) : null;
    },

    async loadSnapshot(id) {
      const rows = await sql<{ ydoc: Uint8Array | null }[]>`
        select ydoc from projects where id = ${id}
      `;
      return rows[0]?.ydoc ?? null;
    },

    async saveSnapshot(id, ydoc) {
      await sql`
        update projects
        set ydoc = ${Buffer.from(ydoc)}, updated_at = now()
        where id = ${id}
      `;
    },
  };
}
