/**
 * One eval task, end to end (docs/evals/README.md):
 *
 *   1. the fixture project becomes the agent's Y.Doc; a collaborator starts
 *      typing when the task has one;
 *   2. the agent core runs with the given ModelClient, the real file tools
 *      (instant typing: nobody is watching) and the Docker sandbox's run tools,
 *      on the given tier's limits, and records its trace;
 *   3. the graders judge the trace and the final files, running the final
 *      project in a fresh sandbox of their own.
 *
 * The same function runs real-model evals, the graders' self-tests (with a
 * scripted model playing the reference solution) and the fixture replays.
 * The collaborator's own lines are taken out of the files graders see, so
 * they judge only the agent.
 */
import {
  agentInputs,
  composeToolHost,
  createDocTools,
  createStopSource,
  instantTypist,
  runAgent,
  startingProject,
  type AgentEvent,
  type AgentTrace,
  type Clock,
  type ModelClient,
} from '@collabcode/agent';
import {
  agentOrigin,
  createAgentUndo,
  createNodeId,
  resolveDocTree,
  type AgentTier,
} from '@collabcode/shared';
import type {
  FailureCategory,
  GradeContext,
  GraderResult,
  GradingSandbox,
} from '../graders/grader.js';
import { categorize, graderResult } from '../graders/grading.js';
import {
  startSimulatedCollaborator,
  withoutCollaboratorLines,
} from '../multiplayer/simulated-collaborator.js';
import { ProjectDir, documentFiles } from '../sandbox/project-dir.js';
import { createSandboxRuntime, type SandboxAvailability } from '../sandbox/sandbox-runtime.js';
import { SessionContainer } from '../sandbox/session-container.js';
import type { TaskDefinition } from '../tasks/task.js';
import { buildProjectDoc } from './fixture-project.js';
import { gradingSandboxes } from './grading-sandbox.js';

export type TaskRunOptions = {
  task: TaskDefinition;
  runId: string;
  model: ModelClient;
  image: string;
  baked: ReadonlySet<string>;
  clock: Clock;
  tier: AgentTier;
  onEvent?: (event: AgentEvent) => void;
};

export type TaskRun = {
  taskId: string;
  trace: AgentTrace;
  initialFiles: ReadonlyMap<string, string>;
  finalFiles: ReadonlyMap<string, string>;
  grades: GraderResult[];
  passed: boolean;
  /** Why it failed, or null when it passed. */
  category: FailureCategory | null;
};

const DEFAULT_SANDBOX_REASON =
  'Running code needs cross-origin isolation, and this page was loaded without the headers that turn it on (Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy). You can still edit.';

function availabilityOf(task: TaskDefinition): SandboxAvailability {
  const reason = task.sandboxReason ?? DEFAULT_SANDBOX_REASON;
  switch (task.sandbox ?? 'available') {
    case 'available':
      return { kind: 'available' };
    case 'unavailable-known':
      return { kind: 'unavailable-known', reason };
    case 'unavailable-discovered':
      return { kind: 'unavailable-discovered', reason };
  }
}

function forGrading(files: ReadonlyMap<string, string>): Map<string, string> {
  return new Map([...files].map(([path, content]) => [path, withoutCollaboratorLines(content)]));
}

export async function runTask(options: TaskRunOptions): Promise<TaskRun> {
  const { task, runId, clock, image, baked } = options;
  const doc = await buildProjectDoc(task.project);
  const initialFiles = documentFiles(doc);
  const sessionId = createNodeId();
  const origin = agentOrigin(sessionId);
  const availability = availabilityOf(task);

  const project = await ProjectDir.create(runId, task.id);
  const container = await SessionContainer.start({ image, projectDir: project.path, runId });
  const collaborator = task.collaborator
    ? startSimulatedCollaborator({
        doc,
        tree: resolveDocTree(doc),
        path: task.collaborator.path,
        clock,
      })
    : null;
  const runtime = createSandboxRuntime({
    container,
    project,
    files: () => documentFiles(doc),
    baked,
    availability,
    stackShift: task.stackShift ?? 0,
    now: clock.now,
  });
  const docTools = createDocTools({
    doc,
    origin,
    actor: { userId: `agent-${sessionId}`, userName: 'AI teammate' },
    undo: createAgentUndo(doc, origin),
    presence: {
      hostUserId: 'eval-host',
      selfClientId: doc.clientID,
      peers: () => (collaborator ? [collaborator.peer()] : []),
    },
    typist: instantTypist,
    now: clock.now,
  });

  let trace: AgentTrace;
  try {
    const result = await runAgent({
      sessionId,
      inputs: agentInputs(doc, task.goal, availability.kind !== 'unavailable-known'),
      tier: options.tier,
      model: options.model,
      tools: composeToolHost(docTools, runtime),
      clock,
      stop: createStopSource().signal,
      project: startingProject(doc),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
    trace = result.trace;
  } finally {
    collaborator?.stop();
    await runtime.dispose();
    await container.remove();
  }

  const finalFiles = forGrading(documentFiles(doc));
  const startFiles = forGrading(initialFiles);
  const sandboxes = gradingSandboxes({ image, baked, runId, label: task.id });
  let shared: Promise<GradingSandbox> | null = null;
  const context: GradeContext = {
    trace,
    initialFiles: startFiles,
    finalFiles,
    sandbox: () => (shared ??= sandboxes.open(finalFiles)),
    sandboxWith: (files) => sandboxes.open(files),
  };
  const grades: GraderResult[] = [];
  try {
    for (const grader of task.graders) {
      try {
        grades.push(graderResult(grader, await grader.grade(context)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        grades.push({
          id: grader.id,
          passed: false,
          detail: `the grader broke: ${message}`,
          category: 'harness-error',
        });
      }
    }
  } finally {
    await sandboxes.close();
  }
  const category = categorize(trace, grades);
  return {
    taskId: task.id,
    trace,
    initialFiles: startFiles,
    finalFiles,
    grades,
    passed: category === null,
    category,
  };
}
