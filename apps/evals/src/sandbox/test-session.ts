/**
 * For the sandbox's own specs: whether Docker is here (CI requires it with
 * REQUIRE_DOCKER=1, so the specs cannot silently skip there), and a sandbox
 * session over a project made from a template.
 */
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStopSource, type RuntimeToolCall, type ToolOutcome } from '@collabcode/agent';
import { createProjectUpdate } from '@collabcode/shared';
import * as Y from 'yjs';
import { dockerAvailable } from './docker.js';
import { bakedDependencies, ensureSandboxImage } from './image.js';
import { ProjectDir, WORK_ROOT, documentFiles } from './project-dir.js';
import {
  createSandboxRuntime,
  type SandboxAvailability,
  type SandboxRuntime,
} from './sandbox-runtime.js';
import { SessionContainer } from './session-container.js';

export async function dockerForSpecs(): Promise<boolean> {
  const available = await dockerAvailable();
  if (!available && process.env['REQUIRE_DOCKER'] === '1') {
    throw new Error('REQUIRE_DOCKER=1, but no Docker daemon answered.');
  }
  return available;
}

export type TestSession = {
  doc: Y.Doc;
  container: SessionContainer;
  project: ProjectDir;
  runtime: SandboxRuntime;
  call: (tool: RuntimeToolCall) => Promise<ToolOutcome>;
};

export function createTestSessions(runId: string) {
  let image = '';
  let count = 0;
  return {
    async prepare(): Promise<void> {
      image = await ensureSandboxImage();
    },
    async open(
      options: { availability?: SandboxAvailability; stackShift?: number } = {},
    ): Promise<TestSession> {
      count += 1;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, createProjectUpdate({ name: 'Eval', template: 'express-api' }).update);
      const project = await ProjectDir.create(runId, `session-${String(count)}`);
      const container = await SessionContainer.start({ image, projectDir: project.path, runId });
      const runtime = createSandboxRuntime({
        container,
        project,
        files: () => documentFiles(doc),
        baked: await bakedDependencies(),
        availability: options.availability ?? { kind: 'available' },
        stackShift: options.stackShift ?? 0,
        now: Date.now,
      });
      const call = (tool: RuntimeToolCall) => runtime.execute(tool, createStopSource().signal);
      return { doc, container, project, runtime, call };
    },
    async close(): Promise<void> {
      await SessionContainer.removeRun(runId);
      await rm(resolve(WORK_ROOT, runId), { recursive: true, force: true });
    },
  };
}
