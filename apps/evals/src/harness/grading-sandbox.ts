/**
 * The graders' sandbox: the final project, in a fresh container of its own
 * (the same image and locks as the agent's), started the way Run starts it.
 * The agent never saw this server, so its checks are hidden from the agent.
 */
import { createStopSource } from '@collabcode/agent';
import type { GradingSandbox } from '../graders/grader.js';
import { ProjectDir } from '../sandbox/project-dir.js';
import { createSandboxRuntime, requestInSandbox } from '../sandbox/sandbox-runtime.js';
import { SessionContainer } from '../sandbox/session-container.js';

const COMMAND_MS = 60_000;

export type SandboxFactory = {
  open: (files: ReadonlyMap<string, string>) => Promise<GradingSandbox>;
  /** Removes every container it started. */
  close: () => Promise<void>;
};

export function gradingSandboxes(options: {
  image: string;
  baked: ReadonlySet<string>;
  runId: string;
  /** Names this task's grading directories. */
  label: string;
}): SandboxFactory {
  const containers: SessionContainer[] = [];
  let opened = 0;
  return {
    async open(files) {
      opened += 1;
      const project = await ProjectDir.create(
        options.runId,
        `${options.label}-grading-${String(opened)}`,
      );
      await project.sync(files);
      const container = await SessionContainer.start({
        image: options.image,
        projectDir: project.path,
        runId: options.runId,
      });
      containers.push(container);
      const runtime = createSandboxRuntime({
        container,
        project,
        files: () => files,
        baked: options.baked,
        availability: { kind: 'available' },
        stackShift: 0,
        now: Date.now,
      });
      let started: Promise<string | null> | null = null;
      /** Starts the project once; null when it serves, else what went wrong. */
      const start = (): Promise<string | null> => {
        started ??= runtime
          .execute({ name: 'run_project', input: {} }, createStopSource().signal)
          .then((outcome) => (runtime.port() === null ? outcome.output : null));
        return started;
      };
      return {
        async request(request) {
          const problem = await start();
          const port = runtime.port();
          if (problem !== null || port === null) {
            return {
              kind: 'not-running',
              message: `the project did not start: ${(problem ?? '').slice(0, 300)}`,
            };
          }
          return requestInSandbox(container, port, request);
        },
        async command(command, args) {
          const result = await container.exec([command, ...args], { timeoutMs: COMMAND_MS });
          return {
            code: result.timedOut ? -1 : result.code,
            output: `${result.stdout}${result.stderr}`,
          };
        },
      };
    },
    async close() {
      await Promise.all(containers.map((container) => container.remove()));
    },
  };
}
