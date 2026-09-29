/**
 * The API console's helper: a small Node program, run inside the container
 * with `node -e` once per request, that calls the running server on
 * localhost and prints the result as one framed line (request-codec.ts).
 * Running inside the container is what avoids CORS entirely.
 *
 * It is plain JavaScript for the container's Node (22 today), imports nothing
 * from the project, and writes nothing to disk. Arguments: the encoded
 * request, the nonce for this request, and the server's port.
 *
 * It reads at most MAX_BODY_BYTES of the body, never follows redirects (the
 * console shows them as they are), and gives up after REQUEST_TIMEOUT_MS.
 *
 * The script contains no backslash, `$`, backtick or double quote. WebContainer's
 * `spawn` was found to process a backslash escape inside an argument (`'\n'`
 * reached Node as `'n'`), which real Node never does, so the script avoids
 * every character a shell might interpret; a test enforces it.
 */
import { MAX_BODY_BYTES, REQUEST_TIMEOUT_MS, RESPONSE_PREFIX_START } from './request-codec.js';

export const REQUEST_SCRIPT = `
const [encoded, nonce, port] = process.argv.slice(1);
const LIMIT = ${String(MAX_BODY_BYTES)};
const NEWLINE = String.fromCharCode(10);
const started = performance.now();
const elapsed = () => Math.round((performance.now() - started) * 10) / 10;
const print = (value) => {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  process.stdout.write(NEWLINE + '${RESPONSE_PREFIX_START}' + nonce + ':' + payload + NEWLINE);
};
(async () => {
  const request = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  const response = await fetch('http://localhost:' + port + request.path, {
    method: request.method,
    headers: request.headers,
    body: request.body === null ? undefined : request.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(${String(REQUEST_TIMEOUT_MS)}),
  });
  const chunks = [];
  let size = 0;
  let truncated = false;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = LIMIT - size;
      chunks.push(value.subarray(0, room));
      size += Math.min(value.length, room);
      if (value.length > room) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  }
  print({
    ok: true,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers],
    body: Buffer.concat(chunks).toString('base64'),
    size,
    truncated,
    ms: elapsed(),
  });
})().catch((error) => {
  const message = error && error.message ? String(error.message) : String(error);
  const cause = error && error.cause && error.cause.message ? ' (' + error.cause.message + ')' : '';
  print({ ok: false, error: (message + cause).slice(0, 2000), ms: elapsed() });
});
`;
