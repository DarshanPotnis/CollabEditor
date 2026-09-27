/**
 * In-memory ProjectsRepo. Used by the integration tests so they can exercise
 * the real Hocuspocus and Express wiring without a database.
 */
import type { CreateProjectInput, ProjectRecord, ProjectsRepo } from './projects-repo.js';

type Stored = ProjectRecord & { ydoc: Uint8Array | null };

export type MemoryProjectsRepo = ProjectsRepo & {
  readonly size: number;
  clear(): void;
};

export function createMemoryProjectsRepo(): MemoryProjectsRepo {
  const projects = new Map<string, Stored>();

  function record(stored: Stored): ProjectRecord {
    const { ydoc: _ydoc, ...rest } = stored;
    return { ...rest };
  }

  return {
    get size() {
      return projects.size;
    },

    clear() {
      projects.clear();
    },

    create(input: CreateProjectInput) {
      const now = new Date();
      const stored: Stored = {
        id: input.id,
        name: input.name,
        template: input.template,
        createdAt: now,
        updatedAt: now,
        ydoc: input.ydoc,
      };
      projects.set(stored.id, stored);
      return Promise.resolve(record(stored));
    },

    findById(id: string) {
      const stored = projects.get(id);
      return Promise.resolve(stored ? record(stored) : null);
    },

    loadSnapshot(id: string) {
      return Promise.resolve(projects.get(id)?.ydoc ?? null);
    },

    saveSnapshot(id: string, ydoc: Uint8Array) {
      const stored = projects.get(id);
      if (stored) {
        stored.ydoc = ydoc;
        stored.updatedAt = new Date();
      }
      return Promise.resolve();
    },
  };
}
