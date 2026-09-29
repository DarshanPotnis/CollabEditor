/**
 * How many requests the eval key has made today, per model, kept in
 * apps/evals/.usage.json (git-ignored) so it survives from one run to the
 * next: a comparison spread over several days picks up where it stopped, and
 * never goes over the day's limit. Days are Pacific time, when Google resets.
 *
 * Every attempt that reached the provider counts, a busy or refused one
 * included, since the provider counts those too.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const LEDGER_PATH = fileURLToPath(new URL('../../.usage.json', import.meta.url));
const DAYS_KEPT = 7;

const ledgerSchema = z.record(z.string(), z.record(z.string(), z.number().int().nonnegative()));
type Usage = z.infer<typeof ledgerSchema>;

/** The date in the Pacific time zone, as YYYY-MM-DD. */
export function pacificDay(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(epochMs);
}

export class DailyLimitReached extends Error {
  constructor(model: string, used: number, limit: number) {
    super(
      `The eval project's daily limit for ${model} is used up (${String(used)} of ${String(limit)} requests today, Pacific time). Continue tomorrow; the run resumes where it stopped.`,
    );
    this.name = 'DailyLimitReached';
  }
}

export class RequestLedger {
  private constructor(
    private readonly path: string,
    private usage: Usage,
    private readonly now: () => number,
  ) {}

  static async open(path = LEDGER_PATH, now: () => number = Date.now): Promise<RequestLedger> {
    let usage: Usage = {};
    try {
      usage = ledgerSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      // No ledger yet is an empty one; anything else unreadable is a problem to report.
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    return new RequestLedger(path, usage, now);
  }

  used(model: string): number {
    return this.usage[pacificDay(this.now())]?.[model] ?? 0;
  }

  /** Throws when today's requests for `model` have reached `limit`. */
  ensureRoom(model: string, limit: number): void {
    const used = this.used(model);
    if (used >= limit) throw new DailyLimitReached(model, used, limit);
  }

  async record(model: string): Promise<void> {
    const day = pacificDay(this.now());
    const today = { ...this.usage[day], [model]: this.used(model) + 1 };
    const days = Object.keys({ ...this.usage, [day]: today })
      .sort()
      .slice(-DAYS_KEPT);
    this.usage = Object.fromEntries(
      days.map((kept) => [kept, kept === day ? today : (this.usage[kept] ?? {})]),
    );
    await writeFile(this.path, `${JSON.stringify(this.usage, null, 2)}\n`);
  }
}
