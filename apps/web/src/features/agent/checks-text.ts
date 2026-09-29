/**
 * A finished session's checks, for the panel: the ones it made, confirmed
 * against what it ran, and the ones its finish listed without making them
 * (the core's finish-checks), each with why.
 */
import { checkLabel, type VerifiedChecks } from '@collabcode/agent';

export type ChecksLines = { made: string[]; notMade: string[] };

export function checksLines(checks: VerifiedChecks): ChecksLines {
  return {
    made: checks.made.map(checkLabel),
    notMade: checks.notMade.map(({ check, reason }) => `${checkLabel(check)} (${reason})`),
  };
}
