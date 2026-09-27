import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

function capture(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, logger: createLogger('info', false, destination) };
}

describe('createLogger', () => {
  it('redacts keys wherever a request, its headers or a model target is logged', () => {
    const { lines, logger } = capture();
    logger.info({ req: { headers: { 'x-ai-key': 'k1', authorization: 'k2', cookie: 'k3' } } });
    logger.info({ headers: { 'x-ai-key': 'k4' } });
    logger.info({ target: { provider: 'gemini', apiKey: 'k5' } });
    logger.info({ ai: { call: { target: { apiKey: 'k6' } } } });
    logger.info({ config: { GEMINI_API_KEY: 'k7' } });

    const log = lines.join('');
    for (const secret of ['k1', 'k2', 'k3', 'k4', 'k5', 'k7']) {
      expect(log).not.toContain(`"${secret}"`);
    }
    expect(log).toContain('[redacted]');
  });
});
