/**
 * Tasks about the project's shape: renaming a file and its imports, a
 * refactor that must not change behaviour, adding a test that can fail, and
 * a field renamed across a project too big to be sent whole.
 */
import { fileCheck, nowhere, scope } from '../graders/file-graders.js';
import { httpChecks, testsCatch, type HttpCheck } from '../graders/http-graders.js';
import { covered } from '../graders/trace-graders.js';
import { ALWAYS, NEVER_CHECKS, NEVER_FINISHES, is } from './common.js';
import type { TaskDefinition } from './task.js';

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const SAME_API: readonly HttpCheck[] = [
  { name: 'listing users', method: 'GET', path: '/users', status: 200 },
  { name: 'creating a user', method: 'POST', path: '/users', json: { name: 'Kim' }, status: 201 },
];

const renameRouteFile: TaskDefinition = {
  id: 'rename-route-file',
  title: 'Rename a route file and update its import',
  goal: 'Rename routes/users.js to routes/people.js, and update the import so the API works as before.',
  project: { template: 'express-api' },
  checks: SAME_API,
  graders: [
    ...ALWAYS,
    fileCheck('renamed', 'routes/people.js', { has: [/Router\(\)/] }),
    fileCheck('old-name-gone', 'routes/users.js', { exists: false }),
    fileCheck('import-updated', 'index.js', {
      has: [/from '\.\/routes\/people\.js'/],
      lacks: [/routes\/users\.js/],
    }),
    httpChecks(SAME_API),
    scope(['routes/users.js', 'routes/people.js', 'index.js']),
  ],
  reference: {
    files: 'rename-route-file',
    deletes: ['routes/users.js'],
    summary:
      'Renamed routes/users.js to routes/people.js and updated the import in index.js. Checked GET and POST /users.',
  },
  knownBad: [
    {
      name: 'leaves the old file behind',
      variant: { kind: 'other-solution', files: 'rename-route-file' },
      fails: 'old-name-gone',
    },
  ],
};

const EXTRACT_CHECKS: readonly HttpCheck[] = [
  {
    name: 'no name',
    method: 'POST',
    path: '/users',
    json: {},
    status: 400,
    body: (value) => record(value)['error'] === 'name is required',
  },
  { name: 'a blank name', method: 'POST', path: '/users', json: { name: '  ' }, status: 400 },
  {
    name: 'a valid user',
    method: 'POST',
    path: '/users',
    json: { name: 'Kim' },
    status: 201,
    body: (value) => record(value)['role'] === 'member' && record(value)['name'] === 'Kim',
  },
  { name: 'listing users', method: 'GET', path: '/users', status: 200 },
];

const extractValidation: TaskDefinition = {
  id: 'extract-validation',
  title: 'Refactor without changing behaviour',
  goal: "Move POST /users's validation into a function validateUser in a new file, routes/validate.js, and use it there. The API's behaviour must not change.",
  project: { template: 'express-api' },
  checks: EXTRACT_CHECKS,
  graders: [
    ...ALWAYS,
    fileCheck('extracted', 'routes/validate.js', {
      has: [/export (async )?function validateUser|export const validateUser/],
    }),
    fileCheck('used', 'routes/users.js', { has: [/validateUser/, /from '\.\/validate\.js'/] }),
    httpChecks(EXTRACT_CHECKS),
    scope(['routes/users.js', 'routes/validate.js']),
    covered([
      { name: 'an invalid user', method: 'POST', path: /^\/users$/, status: is(400) },
      { name: 'a valid user', method: 'POST', path: /^\/users$/, status: is(201) },
    ]),
  ],
  reference: {
    files: 'extract-validation',
    summary:
      'Moved the validation of POST /users into validateUser in routes/validate.js, used by routes/users.js. Checked that invalid and valid requests are answered as before.',
  },
  knownBad: [NEVER_CHECKS],
};

const addTest: TaskDefinition = {
  id: 'add-test',
  title: 'Add a test that can fail',
  goal: 'Add a test for GET /users using node:test, which node --test runs.',
  project: { template: 'express-api' },
  graders: [
    ...ALWAYS,
    testsCatch({
      path: 'routes/users.js',
      from: 'res.json(users);',
      to: "res.status(500).json({ error: 'broken' });",
      what: 'GET /users answers 500',
    }),
    scope([/(^|\/)(test\/.*\.js|[^/]*\.test\.[cm]?js)$/, 'package.json']),
  ],
  reference: {
    files: 'add-test',
    summary:
      'Added test/users.test.js: it starts the server and expects GET /users to list the users, starting with Ada Lovelace. node --test runs it.',
  },
  knownBad: [
    {
      name: 'adds a test that cannot fail',
      variant: { kind: 'other-solution', files: 'add-test-that-cannot-fail' },
      fails: 'tests-catch-breakage',
    },
  ],
};

const renameField: TaskDefinition = {
  id: 'large-rename-field',
  title: 'Rename a field across a project too big to send whole',
  goal: 'Rename the createdAt field to created everywhere: in the data, the code and the API responses.',
  project: { template: 'express-api', overlay: 'large-rename-field' },
  checks: [
    {
      name: 'users show created',
      method: 'GET',
      path: '/users',
      status: 200,
      body: (value) =>
        Array.isArray(value) && 'created' in record(value[0]) && !('createdAt' in record(value[0])),
    },
    {
      name: 'posts show created, newest first',
      method: 'GET',
      path: '/posts',
      status: 200,
      body: (value) =>
        Array.isArray(value) &&
        record(value[0])['created'] === '2026-03-09' &&
        !('createdAt' in record(value[0])),
    },
  ],
  graders: [
    ...ALWAYS,
    nowhere('no-createdAt-left', /createdAt/, 'wrong-result'),
    httpChecks([
      {
        name: 'users show created',
        method: 'GET',
        path: '/users',
        status: 200,
        body: (value) => Array.isArray(value) && 'created' in record(value[0]),
      },
      {
        name: 'posts show created, newest first',
        method: 'GET',
        path: '/posts',
        status: 200,
        body: (value) => Array.isArray(value) && record(value[0])['created'] === '2026-03-09',
      },
    ]),
    scope(['routes/users.js', 'routes/posts.js', 'lib/format.js']),
  ],
  reference: {
    files: 'large-rename-field',
    summary:
      'Renamed createdAt to created in routes/users.js, routes/posts.js and lib/format.js. Checked GET /users and GET /posts.',
  },
  knownBad: [
    NEVER_FINISHES,
    {
      name: 'renames it in one file only',
      variant: { kind: 'other-solution', files: 'large-rename-field-partly' },
      fails: 'no-createdAt-left',
    },
  ],
};

export const STRUCTURE_TASKS: readonly TaskDefinition[] = [
  renameRouteFile,
  extractValidation,
  addTest,
  renameField,
];
