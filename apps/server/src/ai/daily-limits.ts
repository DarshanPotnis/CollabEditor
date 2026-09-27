/**
 * Daily allowances for the shared free tier (docs/PLAN-AI.md §6.1): everyone
 * together, per visitor and per project.
 *
 * - Counted in memory. Right for the single instance we run; a restart resets
 *   the counts, and a second instance would need a shared store.
 * - A request is counted when it is accepted, before the model is called, and
 *   not refunded if the call fails. Brute force, and it errs towards protecting
 *   the quota.
 * - Days follow Pacific time, because that is when Google resets the free
 *   quota these limits protect. UTC days would reset about seven hours early
 *   and let twice the budget through within one of Google's days.
 * - Only accepted requests create entries, so the maps hold at most `global`
 *   entries each, however many addresses a script uses.
 */

export type DailyLimits = { global: number; perIp: number; perProject: number };

export type LimitVerdict =
  { ok: true; remaining: number } | { ok: false; exceeded: 'global' | 'ip' | 'project' };

export type DailyLimiter = {
  /**
   * Count one request against every allowance, or against none if any is used
   * up. `remaining` is how many more this caller can make today.
   */
  tryConsume: (caller: { ipKey: string; projectId: string }) => LimitVerdict;
};

const QUOTA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function quotaDay(ms: number): string {
  return QUOTA_DAY.format(ms);
}

export function createDailyLimiter(
  limits: DailyLimits,
  now: () => number = Date.now,
): DailyLimiter {
  let day = quotaDay(now());
  let global = 0;
  const byIp = new Map<string, number>();
  const byProject = new Map<string, number>();

  return {
    tryConsume({ ipKey, projectId }) {
      const today = quotaDay(now());
      if (today !== day) {
        day = today;
        global = 0;
        byIp.clear();
        byProject.clear();
      }

      const ipUsed = byIp.get(ipKey) ?? 0;
      const projectUsed = byProject.get(projectId) ?? 0;
      if (global >= limits.global) return { ok: false, exceeded: 'global' };
      if (ipUsed >= limits.perIp) return { ok: false, exceeded: 'ip' };
      if (projectUsed >= limits.perProject) return { ok: false, exceeded: 'project' };

      global += 1;
      byIp.set(ipKey, ipUsed + 1);
      byProject.set(projectId, projectUsed + 1);
      return {
        ok: true,
        remaining: Math.min(
          limits.global - global,
          limits.perIp - (ipUsed + 1),
          limits.perProject - (projectUsed + 1),
        ),
      };
    },
  };
}
