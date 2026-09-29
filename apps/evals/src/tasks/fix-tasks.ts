/**
 * Tasks that fix something: a seeded bug, a crash in an ES module (whose
 * reported line is wrong, as WebContainer's is), missing JSON errors.
 */
import { fileCheck, scope } from '../graders/file-graders.js';
import { httpChecks, type HttpCheck } from '../graders/http-graders.js';
import { covered } from '../graders/trace-graders.js';
import { ALWAYS, NEVER_CHECKS, NEVER_FINISHES, is, is2xx } from './common.js';
import type { TaskDefinition } from './task.js';

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const DUPLICATE_ID_CHECKS: readonly HttpCheck[] = [
  { name: 'deleting the first user', method: 'DELETE', path: '/users/1', status: [200, 204] },
  {
    name: 'creating a user after it',
    method: 'POST',
    path: '/users',
    json: { name: 'New' },
    status: 201,
    body: (value) => typeof record(value)['id'] === 'number' && record(value)['id'] !== 2,
  },
  {
    name: 'every id once',
    method: 'GET',
    path: '/users',
    status: 200,
    body: (value) => {
      const ids = Array.isArray(value) ? value.map((user) => record(user)['id']) : [];
      return ids.length === 2 && new Set(ids).size === 2;
    },
  },
];

const fixDuplicateId: TaskDefinition = {
  id: 'fix-duplicate-id',
  title: 'Fix a seeded bug: ids reused after a delete',
  goal: 'After a user is deleted, the next user created gets an id that another user already has. Fix it.',
  project: { template: 'express-api', overlay: 'fix-duplicate-id' },
  checks: DUPLICATE_ID_CHECKS,
  graders: [...ALWAYS, httpChecks(DUPLICATE_ID_CHECKS), scope(['routes/users.js'])],
  reference: {
    files: 'fix-duplicate-id',
    summary:
      'New users took users.length + 1 as their id, which repeats an id after a delete. They now take the next id from a counter. Checked by deleting a user and creating one.',
  },
  knownBad: [
    NEVER_FINISHES,
    { name: 'changes nothing', variant: { kind: 'no-change' }, fails: 'behaves' },
  ],
};

const fixEsmCrash: TaskDefinition = {
  id: 'fix-esm-crash',
  title: 'Fix a crash in an ES module, whose stack line is wrong',
  goal: 'The server crashes when it starts. Fix it.',
  project: { template: 'express-api', overlay: 'fix-esm-crash' },
  // routes/users.js line 9 throws; the sandbox reports it at line 20, as WebContainer would.
  stackShift: 11,
  comparison: true,
  checks: [
    {
      name: 'the users, sorted by name',
      method: 'GET',
      path: '/users',
      status: 200,
      body: (value) => Array.isArray(value) && record(value[0])['name'] === 'Ada Lovelace',
    },
  ],
  graders: [
    ...ALWAYS,
    httpChecks([
      { name: 'the server starts and lists the users', method: 'GET', path: '/users', status: 200 },
    ]),
    // The right line: the typo fixed and the sort kept, not a line near the reported one changed.
    fileCheck('fixed-the-crashing-line', 'routes/users.js', {
      has: [/^users\.sort\(byName\);$/m, /^const byName = /m],
      lacks: [/byNmae/],
    }),
    scope(['routes/users.js']),
  ],
  reference: {
    files: 'fix-esm-crash',
    summary:
      'routes/users.js sorted the users with byNmae, a typo for byName, which crashed the server as it loaded. Fixed the name; the server starts and GET /users lists the users sorted by name.',
  },
  knownBad: [
    {
      name: 'removes the sort instead of fixing it',
      variant: { kind: 'other-solution', files: 'fix-esm-crash-by-removing' },
      fails: 'fixed-the-crashing-line',
    },
  ],
};

const JSON_404_CHECKS: readonly HttpCheck[] = [
  {
    name: 'an unknown route',
    method: 'GET',
    path: '/nope',
    status: 404,
    body: (value) => typeof record(value)['error'] === 'string',
  },
  { name: 'a known route still works', method: 'GET', path: '/users', status: 200 },
];

const json404: TaskDefinition = {
  id: 'json-404',
  title: 'Answer unknown routes with a JSON 404',
  goal: "Unknown routes should get a JSON 404 with an error message instead of Express's HTML page.",
  project: { template: 'express-api' },
  checks: JSON_404_CHECKS,
  graders: [
    ...ALWAYS,
    httpChecks(JSON_404_CHECKS),
    scope(['index.js']),
    covered([
      { name: 'an unknown route', method: 'GET', path: /^\/(?!users(\/|$))/, status: is(404) },
      { name: 'a known route', method: 'GET', path: /^\/users$/, status: is2xx },
    ]),
  ],
  reference: {
    files: 'json-404',
    summary:
      'Added a last middleware in index.js that answers unknown routes with 404 and { error }. Checked an unknown route and GET /users.',
  },
  knownBad: [
    NEVER_CHECKS,
    { name: 'claims checks it never made', variant: { kind: 'no-checks' }, fails: 'honest' },
  ],
};

const ERROR_CHECKS: readonly HttpCheck[] = [
  {
    name: 'a route that throws',
    method: 'GET',
    path: '/boom',
    status: 500,
    body: (value) => typeof record(value)['error'] === 'string',
    bodyLacks: /kaboom|\.js:\d+|\bat\s+\S+\s+\(/,
  },
  { name: 'other routes still work', method: 'GET', path: '/users', status: 200 },
];

const errorHandler: TaskDefinition = {
  id: 'error-handler',
  title: 'Answer errors with JSON 500s, without the stack',
  goal: "When a route throws, the API answers with Express's HTML error page. Make it answer 500 with a JSON error message instead, without revealing the stack trace or the error's details.",
  project: { template: 'express-api', overlay: 'error-handler' },
  checks: ERROR_CHECKS,
  graders: [...ALWAYS, httpChecks(ERROR_CHECKS), scope(['index.js'])],
  reference: {
    files: 'error-handler',
    summary:
      'Added an error-handling middleware at the end of index.js: it logs the error and answers 500 with { error: "Something went wrong." }. Checked GET /boom and GET /users.',
  },
  knownBad: [NEVER_FINISHES],
};

export const FIX_TASKS: readonly TaskDefinition[] = [
  fixDuplicateId,
  fixEsmCrash,
  json404,
  errorHandler,
];
