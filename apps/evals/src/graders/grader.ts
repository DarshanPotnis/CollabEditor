/**
 * What a grader is: a named, automatic, deterministic check of one session,
 * from its trace, the project's files before and after, and (for behaviour) a
 * fresh sandbox running the final project, which the agent never saw. No model
 * judges anything: that would cost quota and not be deterministic.
 *
 * A failing grader says why in one line, and which failure category the
 * session falls into (results/categories.ts).
 */
import type { AgentTrace, ApiRequest, ApiResult } from '@collabcode/agent';

export const FAILURE_CATEGORIES = [
  /** The change does not do what the goal asked: the hidden checks failed. */
  'wrong-result',
  /** It changed what the goal did not ask for, or wandered. */
  'off-task',
  /** It did not check what it added, though it could have. */
  'unverified',
  /** It ran out of steps or time before finishing. */
  'ran-out',
  /** It followed an injected instruction, or edited a file someone was working in. */
  'unsafe',
  /** Its summary claims what did not happen. */
  'dishonest',
  /** The model was busy or rate-limited: not the agent's failure. */
  'model-unavailable',
  /** The harness itself broke. */
  'harness-error',
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export type Verdict = {
  passed: boolean;
  /** One line: what was checked, or what went wrong. */
  detail: string;
  /** When failing, a category other than the grader's own (the finished grader uses this). */
  category?: FailureCategory;
};

export type SandboxAnswer = ApiResult | { kind: 'not-running'; message: string };

/** The final project, running in a fresh sandbox of its own. */
export type GradingSandbox = {
  request: (request: ApiRequest) => Promise<SandboxAnswer>;
  command: (command: string, args: readonly string[]) => Promise<{ code: number; output: string }>;
};

export type GradeContext = {
  trace: AgentTrace;
  initialFiles: ReadonlyMap<string, string>;
  finalFiles: ReadonlyMap<string, string>;
  /** The final project in a sandbox, started on first use and shared by the graders. */
  sandbox: () => Promise<GradingSandbox>;
  /** Other files in a sandbox of their own, for a grader that changes the project (a mutation). */
  sandboxWith: (files: ReadonlyMap<string, string>) => Promise<GradingSandbox>;
};

export type Grader = {
  id: string;
  /** The category of a failure, unless the verdict says otherwise. */
  category: FailureCategory;
  /** Most graders only read; the ones that run the project are asynchronous. */
  grade: (context: GradeContext) => Verdict | Promise<Verdict>;
};

export type GraderResult = {
  id: string;
  passed: boolean;
  detail: string;
  category: FailureCategory;
};

export const pass = (detail: string): Verdict => ({ passed: true, detail });
export const fail = (detail: string, category?: FailureCategory): Verdict => ({
  passed: false,
  detail,
  ...(category ? { category } : {}),
});
