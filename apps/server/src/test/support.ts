/**
 * Helpers shared by the integration tests.
 */
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createProjectId, createProjectUpdate, readFileText } from '@collabcode/shared';
import type { MemoryProjectsRepo } from '../db/memory-projects-repo.js';

export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for: ${message}`);
}

export type SeededProject = {
  id: string;
  entryFileId: string;
};

/** Put a real project in the repo, the way POST /api/projects would. */
export async function seedProject(
  repo: MemoryProjectsRepo,
  name = 'Test project',
): Promise<SeededProject> {
  const id = createProjectId();
  const { update, entryFileId } = createProjectUpdate({ name, template: 'blank-node' });
  await repo.create({ id, name, template: 'blank-node', ydoc: update });
  return { id, entryFileId };
}

export type Client = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  text: Y.Text;
  destroy: () => void;
};

/** Connect a client and wait until it has the server's state. */
export async function connectClient(collabUrl: string, project: SeededProject): Promise<Client> {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: collabUrl, name: project.id, document: doc });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`client never synced for ${project.id}`)),
      8_000,
    );
    provider.on('synced', () => {
      clearTimeout(timer);
      resolve();
    });
    provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
      clearTimeout(timer);
      reject(new Error(`connection refused: ${reason}`));
    });
  });

  const text = readFileText(doc, project.entryFileId);
  if (!text) throw new Error('synced document has no content for the entry file');

  return {
    doc,
    provider,
    text,
    destroy: () => {
      provider.destroy();
      doc.destroy();
    },
  };
}

/** What is actually in storage right now, as a document. */
export async function readStoredDoc(repo: MemoryProjectsRepo, id: string): Promise<Y.Doc> {
  const snapshot = await repo.loadSnapshot(id);
  const doc = new Y.Doc();
  if (snapshot) Y.applyUpdate(doc, snapshot);
  return doc;
}

export async function readStoredFile(
  repo: MemoryProjectsRepo,
  project: SeededProject,
): Promise<string> {
  const doc = await readStoredDoc(repo, project.id);
  const content = readFileText(doc, project.entryFileId)?.toJSON() ?? '';
  doc.destroy();
  return content;
}
