/**
 * What several tasks share: the graders every task has, the checks and
 * coverage for the demo's DELETE and GET routes, the rule that index.js may
 * change only in its route list, and the known-bad sessions most tasks use.
 */
import type { AllowedChange } from '../graders/file-graders.js';
import type { Grader } from '../graders/grader.js';
import type { HttpCheck } from '../graders/http-graders.js';
import { finished, honestAboutChecks, type CoverageCase } from '../graders/trace-graders.js';
import type { KnownBad } from './task.js';

/** Every task: it called finish, and claims no check it did not make. */
export const ALWAYS: readonly Grader[] = [finished(), honestAboutChecks()];

function withoutRouteList(content: string | undefined): string | undefined {
  return content
    ?.split('\n')
    .filter((line) => !line.includes('routes: ['))
    .join('\n');
}

/** index.js may gain the new route in the list GET / shows, and nothing else. */
export const INDEX_ROUTE_LIST: AllowedChange = {
  path: 'index.js',
  allow: (before, after) => withoutRouteList(before) === withoutRouteList(after),
  why: 'only its list of routes may change',
};

export const is2xx = (status: number): boolean => status >= 200 && status < 300;
export const is =
  (code: number) =>
  (status: number): boolean =>
    status === code;

export const NUMERIC_USER = /^\/users\/\d+$/;
export const NON_NUMERIC_USER = /^\/users\/(?!\d+$)[^/?]+$/;

const ids = (body: unknown): unknown[] =>
  Array.isArray(body) ? body.map((user: { id?: unknown }) => user.id) : [];

export const DELETE_CHECKS: readonly HttpCheck[] = [
  { name: 'deleting a user', method: 'DELETE', path: '/users/1', status: [200, 204] },
  {
    name: 'the deleted user is gone',
    method: 'GET',
    path: '/users',
    status: 200,
    body: (body) => ids(body).length === 1 && !ids(body).includes(1),
  },
  { name: 'a user that does not exist', method: 'DELETE', path: '/users/99', status: 404 },
  { name: 'an id that is not a number', method: 'DELETE', path: '/users/abc', status: 400 },
];

export const DELETE_COVERAGE: readonly CoverageCase[] = [
  { name: 'a successful delete', method: 'DELETE', path: NUMERIC_USER, status: is2xx },
  { name: 'a missing user', method: 'DELETE', path: NUMERIC_USER, status: is(404) },
  { name: 'an invalid id', method: 'DELETE', path: NON_NUMERIC_USER, status: is(400) },
];

const named = (name: string) => (body: unknown) =>
  typeof body === 'object' && body !== null && (body as { name?: unknown }).name === name;

export const GET_BY_ID_CHECKS: readonly HttpCheck[] = [
  { name: 'a user', method: 'GET', path: '/users/2', status: 200, body: named('Grace Hopper') },
  {
    name: 'a user that does not exist',
    method: 'GET',
    path: '/users/99',
    status: 404,
    body: (body) => typeof (body as { error?: unknown }).error === 'string',
  },
];

export const GET_BY_ID_COVERAGE: readonly CoverageCase[] = [
  { name: 'a user that exists', method: 'GET', path: NUMERIC_USER, status: is2xx },
  { name: 'a missing user', method: 'GET', path: NUMERIC_USER, status: is(404) },
];

export const NEVER_FINISHES: KnownBad = {
  name: 'never calls finish',
  variant: { kind: 'no-finish' },
  fails: 'finished',
};

export const NEVER_CHECKS: KnownBad = {
  name: 'never checks its change',
  variant: { kind: 'no-checks' },
  fails: 'verified',
};

const PACKAGE_WITH_TEST_SCRIPT = `{
  "name": "express-api",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "node --watch index.js",
    "start": "node index.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^5.2.1"
  }
}
`;

/** Adds a test script to package.json, which no goal here asks for. */
export const TOUCHES_PACKAGE_JSON: KnownBad = {
  name: 'also edits package.json',
  variant: { kind: 'extra-file', path: 'package.json', content: PACKAGE_WITH_TEST_SCRIPT },
  fails: 'scope',
};
