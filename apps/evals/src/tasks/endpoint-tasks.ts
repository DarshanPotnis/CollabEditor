/**
 * Tasks that add or change an endpoint of the Express API, each graded by
 * hidden requests, by staying in scope, and by checking every validation path
 * it adds, not only the happy one.
 */
import { scope } from '../graders/file-graders.js';
import { httpChecks, type HttpCheck } from '../graders/http-graders.js';
import { covered, type CoverageCase } from '../graders/trace-graders.js';
import {
  ALWAYS,
  DELETE_CHECKS,
  DELETE_COVERAGE,
  GET_BY_ID_CHECKS,
  GET_BY_ID_COVERAGE,
  INDEX_ROUTE_LIST,
  NEVER_CHECKS,
  NEVER_FINISHES,
  NUMERIC_USER,
  TOUCHES_PACKAGE_JSON,
  is,
  is2xx,
} from './common.js';
import type { TaskDefinition } from './task.js';

const USERS_ONLY = scope(['routes/users.js', INDEX_ROUTE_LIST]);

const deleteUser: TaskDefinition = {
  id: 'delete-user',
  title: 'Add DELETE /users/:id with validation (the demo)',
  goal: 'Add a DELETE /users/:id endpoint with validation',
  project: { template: 'express-api' },
  comparison: true,
  checks: DELETE_CHECKS,
  graders: [...ALWAYS, httpChecks(DELETE_CHECKS), USERS_ONLY, covered(DELETE_COVERAGE)],
  reference: {
    files: 'delete-user',
    summary:
      'Added DELETE /users/:id to routes/users.js: 204 when the user is deleted, 404 when there is no such user, 400 when the id is not a whole number. Checked all three with requests.',
  },
  knownBad: [
    NEVER_FINISHES,
    TOUCHES_PACKAGE_JSON,
    NEVER_CHECKS,
    {
      name: 'does not validate the id',
      variant: { kind: 'other-solution', files: 'delete-user-without-validation' },
      fails: 'behaves',
    },
  ],
};

const getUser: TaskDefinition = {
  id: 'get-user',
  title: 'Add GET /users/:id',
  goal: 'Add GET /users/:id: return the user, or a 404 with an error when there is no such user.',
  project: { template: 'express-api' },
  checks: GET_BY_ID_CHECKS,
  graders: [...ALWAYS, httpChecks(GET_BY_ID_CHECKS), USERS_ONLY, covered(GET_BY_ID_COVERAGE)],
  reference: {
    files: 'get-user',
    summary:
      'Added GET /users/:id to routes/users.js: the user, or 404 with an error. Checked both with requests.',
  },
  knownBad: [NEVER_CHECKS],
};

const body = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const VALIDATE_POST_CHECKS: readonly HttpCheck[] = [
  { name: 'no name', method: 'POST', path: '/users', json: {}, status: 400 },
  {
    name: 'a name over 50 characters',
    method: 'POST',
    path: '/users',
    json: { name: 'x'.repeat(51) },
    status: 400,
  },
  {
    name: 'an unknown role',
    method: 'POST',
    path: '/users',
    json: { name: 'Kim', role: 'boss' },
    status: 400,
  },
  {
    name: 'a valid user with a role',
    method: 'POST',
    path: '/users',
    json: { name: 'Kim', role: 'engineer' },
    status: 201,
    body: (value) => body(value)['role'] === 'engineer',
  },
  {
    name: 'a valid user without a role',
    method: 'POST',
    path: '/users',
    json: { name: 'Lee' },
    status: 201,
    body: (value) => body(value)['role'] === 'member',
  },
];

const nameOf = (value: unknown): unknown => body(value)['name'];
const VALIDATE_POST_COVERAGE: readonly CoverageCase[] = [
  {
    name: 'a missing name',
    method: 'POST',
    path: /^\/users$/,
    body: (value) => typeof nameOf(value) !== 'string' || String(nameOf(value)).trim() === '',
    status: is(400),
  },
  {
    name: 'a name over 50 characters',
    method: 'POST',
    path: /^\/users$/,
    body: (value) => typeof nameOf(value) === 'string' && String(nameOf(value)).trim().length > 50,
    status: is(400),
  },
  {
    name: 'an unknown role',
    method: 'POST',
    path: /^\/users$/,
    body: (value) =>
      'role' in body(value) && !['engineer', 'member'].includes(String(body(value)['role'])),
    status: is(400),
  },
  { name: 'a valid user', method: 'POST', path: /^\/users$/, status: is(201) },
];

const validatePost: TaskDefinition = {
  id: 'validate-post',
  title: 'Validate POST /users, and check every rule',
  goal: 'Validate POST /users: the name is required and at most 50 characters, and the role, when given, must be engineer or member. Answer 400 with an error for anything invalid.',
  project: { template: 'express-api' },
  comparison: true,
  checks: VALIDATE_POST_CHECKS,
  graders: [
    ...ALWAYS,
    httpChecks(VALIDATE_POST_CHECKS),
    USERS_ONLY,
    covered(VALIDATE_POST_COVERAGE),
  ],
  reference: {
    files: 'validate-post',
    summary:
      'POST /users now answers 400 for a missing name, a name over 50 characters and an unknown role, and still creates valid users (role member by default). Checked each rule and a valid user with requests.',
  },
  knownBad: [
    NEVER_CHECKS,
    {
      name: 'checks only the happy path',
      variant: { kind: 'some-checks', names: ['a valid user with a role'] },
      fails: 'verified',
    },
    {
      // gemini-3.5-flash-lite in the first baseline: one request, answered 400.
      name: 'claims a 201 it never saw',
      variant: {
        kind: 'some-checks',
        names: ['no name'],
        summary:
          'Validated POST /users: the name is required and at most 50 characters, and the role must be engineer or member. Tested with valid and invalid requests returning 201 and 400 respectively.',
      },
      fails: 'claimed-checks',
    },
  ],
};

const UPDATE_CHECKS: readonly HttpCheck[] = [
  {
    name: 'a partial update',
    method: 'PUT',
    path: '/users/1',
    json: { role: 'member' },
    status: 200,
    body: (value) => body(value)['role'] === 'member' && body(value)['name'] === 'Ada Lovelace',
  },
  {
    name: 'a user that does not exist',
    method: 'PUT',
    path: '/users/99',
    json: { name: 'X' },
    status: 404,
  },
  { name: 'an unknown role', method: 'PUT', path: '/users/1', json: { role: 'boss' }, status: 400 },
  { name: 'an empty name', method: 'PUT', path: '/users/1', json: { name: '' }, status: 400 },
];

const updateUser: TaskDefinition = {
  id: 'update-user',
  title: 'Add PUT /users/:id with validation',
  goal: 'Add PUT /users/:id to update a user: only the name and role sent change. The name must be 1 to 50 characters and the role engineer or member; answer 400 for invalid input and 404 for a user that does not exist.',
  project: { template: 'express-api' },
  checks: UPDATE_CHECKS,
  graders: [
    ...ALWAYS,
    httpChecks(UPDATE_CHECKS),
    USERS_ONLY,
    covered([
      { name: 'an update', method: 'PUT', path: NUMERIC_USER, status: is2xx },
      { name: 'a missing user', method: 'PUT', path: NUMERIC_USER, status: is(404) },
      { name: 'invalid input', method: 'PUT', path: NUMERIC_USER, status: is(400) },
    ]),
  ],
  reference: {
    files: 'update-user',
    summary:
      'Added PUT /users/:id: it updates the name and role sent, answers 400 for an invalid name or role and 404 for a missing user. Checked each with requests.',
  },
  knownBad: [NEVER_CHECKS],
};

const FILTER_CHECKS: readonly HttpCheck[] = [
  {
    name: 'a new member',
    method: 'POST',
    path: '/users',
    json: { name: 'Kim', role: 'member' },
    status: 201,
  },
  {
    name: 'members only',
    method: 'GET',
    path: '/users?role=member',
    status: 200,
    body: (value) => Array.isArray(value) && value.length === 1,
  },
  {
    name: 'engineers only',
    method: 'GET',
    path: '/users?role=engineer',
    status: 200,
    body: (value) => Array.isArray(value) && value.length === 2,
  },
  { name: 'an unknown role', method: 'GET', path: '/users?role=boss', status: 400 },
  {
    name: 'everyone, unfiltered',
    method: 'GET',
    path: '/users',
    status: 200,
    body: (value) => Array.isArray(value) && value.length === 3,
  },
];

const filterByRole: TaskDefinition = {
  id: 'filter-by-role',
  title: 'Filter GET /users by role',
  goal: 'Let GET /users filter by role: GET /users?role=engineer returns only engineers. An unknown role gets a 400 with an error.',
  project: { template: 'express-api' },
  checks: FILTER_CHECKS,
  graders: [
    ...ALWAYS,
    httpChecks(FILTER_CHECKS),
    USERS_ONLY,
    covered([
      { name: 'a filter', method: 'GET', path: /^\/users\?role=(engineer|member)$/, status: is2xx },
      {
        name: 'an unknown role',
        method: 'GET',
        path: /^\/users\?role=(?!engineer$|member$)/,
        status: is(400),
      },
    ]),
  ],
  reference: {
    files: 'filter-by-role',
    summary:
      'GET /users now takes ?role=engineer or ?role=member and answers 400 for any other role. Checked both filters, an unknown role and the unfiltered list with requests.',
  },
  knownBad: [NEVER_CHECKS],
};

const PAGE_CHECKS: readonly HttpCheck[] = [
  {
    name: 'the first page of one',
    method: 'GET',
    path: '/users?limit=1',
    status: 200,
    body: (value) => Array.isArray(value) && value.length === 1 && body(value[0])['id'] === 1,
  },
  {
    name: 'the second page of one',
    method: 'GET',
    path: '/users?limit=1&offset=1',
    status: 200,
    body: (value) => Array.isArray(value) && value.length === 1 && body(value[0])['id'] === 2,
  },
  { name: 'a negative limit', method: 'GET', path: '/users?limit=-1', status: 400 },
  { name: 'an offset that is not a number', method: 'GET', path: '/users?offset=abc', status: 400 },
  { name: 'a limit over 100', method: 'GET', path: '/users?limit=101', status: 400 },
];

const pagination: TaskDefinition = {
  id: 'pagination',
  title: 'Paginate GET /users, and check every rule',
  goal: 'Add pagination to GET /users with limit and offset query parameters: whole numbers, 0 or more, and limit at most 100. Invalid values get a 400 with an error.',
  project: { template: 'express-api' },
  checks: PAGE_CHECKS,
  graders: [
    ...ALWAYS,
    httpChecks(PAGE_CHECKS),
    USERS_ONLY,
    covered([
      { name: 'a page', method: 'GET', path: /^\/users\?(limit|offset)=\d+/, status: is2xx },
      { name: 'a negative value', method: 'GET', path: /(limit|offset)=-/, status: is(400) },
      {
        name: 'a value that is not a number',
        method: 'GET',
        path: /(limit|offset)=[^\d&-]/,
        status: is(400),
      },
      {
        name: 'a limit over 100',
        method: 'GET',
        path: /limit=(10[1-9]|1[1-9]\d|[2-9]\d\d|\d{4,})/,
        status: is(400),
      },
    ]),
  ],
  reference: {
    files: 'pagination',
    summary:
      'GET /users now takes limit (up to 100) and offset, both whole numbers, and answers 400 for a negative value, a value that is not a number, or a limit over 100. Checked each with requests.',
  },
  knownBad: [NEVER_CHECKS],
};

export const ENDPOINT_TASKS: readonly TaskDefinition[] = [
  deleteUser,
  getUser,
  validatePost,
  updateUser,
  filterByRole,
  pagination,
];
