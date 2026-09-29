import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 4747;

test('GET /users lists the users', async (t) => {
  const server = spawn(process.execPath, ['index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  t.after(() => server.kill());
  let response;
  for (let attempt = 0; attempt < 50 && response === undefined; attempt += 1) {
    try {
      response = await fetch(`http://localhost:${PORT}/users`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(response, 'the server did not start');
  assert.equal(response.status, 200);
  const users = await response.json();
  assert.equal(users[0].name, 'Ada Lovelace');
});
