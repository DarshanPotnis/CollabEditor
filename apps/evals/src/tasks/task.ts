/**
 * What an eval task is (docs/evals/README.md): a fixture project, a goal, the
 * conditions it runs under, and automatic graders. Every task also carries a
 * reference solution, which a scripted session plays through the real harness
 * and which must pass every grader, and known-bad sessions, each of which must
 * fail the grader it names: graders are code, and this is their test.
 */
import type { SandboxAvailability } from '../sandbox/sandbox-runtime.js';
import type { Grader } from '../graders/grader.js';
import type { HttpCheck } from '../graders/http-graders.js';

export type ProjectSpec = {
  template: 'express-api' | 'blank-node';
  /** A folder of apps/evals/fixtures/projects whose files are laid over the template. */
  overlay?: string;
};

export type ReferenceSolution = {
  /** A folder of apps/evals/fixtures/solutions laid over the fixture: the project once solved. None when nothing should change. */
  files?: string;
  /** Files the solution deletes. */
  deletes?: readonly string[];
  /** What a good summary says. */
  summary: string;
};

/** A session that must fail one grader, to show that grader can fail. */
export type KnownBad = {
  name: string;
  /** How it differs from the reference session. */
  variant: KnownBadVariant;
  /** The grader it must fail. */
  fails: string;
};

export type KnownBadVariant =
  /** It never calls finish. */
  | { kind: 'no-finish' }
  /** It changes a file the goal did not ask for. */
  | { kind: 'extra-file'; path: string; content: string }
  /** It changes nothing. */
  | { kind: 'no-change' }
  /** It never sends the checks. */
  | { kind: 'no-checks' }
  /** It sends only the checks with these names, and says `summary` when given. */
  | { kind: 'some-checks'; names: readonly string[]; summary?: string }
  /** It says something else in its summary. */
  | { kind: 'summary'; summary: string }
  /** It makes these tool calls before finishing. */
  | { kind: 'extra-calls'; calls: ReadonlyArray<{ toolName: string; input: unknown }> }
  /** It solves the task with this folder of solutions instead. */
  | { kind: 'other-solution'; files: string; deletes?: readonly string[] };

export type TaskDefinition = {
  id: string;
  /** One line for reports. */
  title: string;
  goal: string;
  project: ProjectSpec;
  sandbox?: SandboxAvailability['kind'];
  /** Why the sandbox is unavailable, when it is. */
  sandboxReason?: string;
  /** A person typing in this file for the whole session. */
  collaborator?: { path: string };
  /** Lines to shift ES-module stack frames by, as WebContainer does. */
  stackShift?: number;
  /** In the 6-task subset used to compare models on few requests. */
  comparison?: boolean;
  /** The hidden HTTP checks, which the reference session also sends as its own checks. */
  checks?: readonly HttpCheck[];
  graders: readonly Grader[];
  reference: ReferenceSolution;
  knownBad: readonly KnownBad[];
};
