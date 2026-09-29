/**
 * Graders that judge behaviour: the final project runs in a fresh sandbox the
 * agent never saw, and these send it their own requests, in order, or run a
 * command there. The requests are the task's, not the agent's, so a change
 * that only passes the agent's own checks does not pass these.
 */
import type { HttpMethod } from '@collabcode/agent';
import {
  fail,
  pass,
  type ProjectGrader,
  type GradingSandbox,
  type SandboxAnswer,
} from './grader.js';

export type HttpCheck = {
  name: string;
  method: HttpMethod;
  path: string;
  /** Sent as JSON. */
  json?: unknown;
  status: number | readonly number[];
  /** What the response body, parsed as JSON, must satisfy. */
  body?: (body: unknown) => boolean;
  /** What the raw body must not contain. */
  bodyLacks?: RegExp;
};

function describe(answer: SandboxAnswer): { status: number | null; text: string } {
  switch (answer.kind) {
    case 'response':
      return {
        status: answer.response.status,
        text: new TextDecoder().decode(answer.response.body),
      };
    case 'request-failed':
      return { status: null, text: `the request failed: ${answer.message}` };
    case 'invalid-output':
      return { status: null, text: `unreadable: ${answer.message}` };
    case 'not-running':
      return { status: null, text: answer.message };
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON: a body check then sees the text.
    return text;
  }
}

async function send(sandbox: GradingSandbox, check: HttpCheck): Promise<string | null> {
  const answer = await sandbox.request({
    method: check.method,
    path: check.path,
    headers: check.json === undefined ? [] : [['content-type', 'application/json']],
    body: check.json === undefined ? null : JSON.stringify(check.json),
  });
  const { status, text } = describe(answer);
  const wanted = typeof check.status === 'number' ? [check.status] : check.status;
  if (status === null || !wanted.includes(status)) {
    return `${check.name}: expected ${wanted.join(' or ')}, got ${status === null ? text : `${String(status)} ${text.slice(0, 120)}`}`;
  }
  if (check.body && !check.body(parsed(text)))
    return `${check.name}: unexpected body ${text.slice(0, 160)}`;
  if (check.bodyLacks?.test(text)) return `${check.name}: the body has ${String(check.bodyLacks)}`;
  return null;
}

/** The final project answers these requests, in order, as it should. */
export function httpChecks(checks: readonly HttpCheck[], id = 'behaves'): ProjectGrader {
  return {
    id,
    category: 'wrong-result',
    reads: 'project',
    async grade({ sandbox }) {
      const running = await sandbox();
      for (const check of checks) {
        const problem = await send(running, check);
        if (problem !== null) return fail(problem);
      }
      return pass(`${String(checks.length)} hidden check${checks.length === 1 ? '' : 's'} passed`);
    },
  };
}

/**
 * The project's own tests pass, and fail once the grader breaks what they
 * should cover: a test that cannot fail tests nothing.
 */
export function testsCatch(mutation: {
  path: string;
  from: string;
  to: string;
  what: string;
}): ProjectGrader {
  return {
    id: 'tests-catch-breakage',
    category: 'wrong-result',
    reads: 'project',
    async grade({ sandbox, sandboxWith, finalFiles }) {
      const passing = await (await sandbox()).command('node', ['--test']);
      if (passing.code !== 0)
        return fail(`node --test fails on the final project:\n${passing.output.slice(-400)}`);
      const original = finalFiles.get(mutation.path);
      if (original === undefined || !original.includes(mutation.from)) {
        return fail(
          `${mutation.path} no longer has the code the mutation changes`,
          'harness-error',
        );
      }
      const broken = new Map(finalFiles);
      broken.set(mutation.path, original.replace(mutation.from, mutation.to));
      const afterBreaking = await (await sandboxWith(broken)).command('node', ['--test']);
      return afterBreaking.code !== 0
        ? pass(`node --test passes, and fails once ${mutation.what}`)
        : fail(`node --test still passes after ${mutation.what}`);
    },
  };
}
