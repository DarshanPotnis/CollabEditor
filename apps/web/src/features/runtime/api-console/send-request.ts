/**
 * Runs one API console request in the container: a fresh helper process per
 * request, read from its own output stream only (request-codec.ts explains
 * why that and the nonce make the result spoof-proof).
 */
import type { Container, ContainerProcess } from '../container.js';
import {
  REQUEST_SCRIPT,
  REQUEST_TIMEOUT_MS,
  createNonce,
  encodeRequest,
  parseHelperOutput,
  type ApiRequest,
  type ApiResult,
} from '@collabcode/agent';

/** Enough for a full-size response in base64 plus anything Node prints. */
const MAX_OUTPUT_CHARS = 4 * 1024 * 1024;
/** The helper gives up at REQUEST_TIMEOUT_MS; this is the backstop. */
const KILL_AFTER_MS = REQUEST_TIMEOUT_MS + 10_000;

async function readAll(child: ContainerProcess): Promise<string> {
  let text = '';
  await child.output.pipeTo(
    new WritableStream({
      write(chunk) {
        if (text.length < MAX_OUTPUT_CHARS) text += chunk;
      },
    }),
  );
  return text;
}

export async function sendRequest(
  container: Container,
  port: number,
  request: ApiRequest,
): Promise<ApiResult> {
  const nonce = createNonce();
  const child = await container.spawn('node', [
    '-e',
    REQUEST_SCRIPT,
    encodeRequest(request),
    nonce,
    String(port),
  ]);
  const backstop = setTimeout(() => child.kill(), KILL_AFTER_MS);
  try {
    const [output] = await Promise.all([readAll(child), child.exit]);
    return parseHelperOutput(output, nonce);
  } finally {
    clearTimeout(backstop);
  }
}
