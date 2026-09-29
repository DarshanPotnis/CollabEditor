import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ISOLATION_HEADERS } from './isolation-headers.js';

const vercelSchema = z.object({
  headers: z.array(
    z.object({
      source: z.string(),
      headers: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
  ),
});

function vercelConfig(): z.infer<typeof vercelSchema> {
  const raw = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');
  return vercelSchema.parse(JSON.parse(raw));
}

describe('production isolation headers', () => {
  it('vercel.json sends every isolation header, with our values, on every path', () => {
    const everyPath = vercelConfig().headers.find((rule) => rule.source === '/(.*)');
    expect(everyPath).toBeDefined();
    const sent = Object.fromEntries(
      everyPath?.headers.map((header) => [header.key, header.value]) ?? [],
    );
    expect(sent).toMatchObject(ISOLATION_HEADERS);
  });
});
