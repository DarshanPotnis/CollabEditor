/** A recorded trace from packages/agent/fixtures/traces, read and upgraded to this version. */
import { readFileSync } from 'node:fs';
import { parseTrace, type AgentTrace } from '../trace.js';

export function fixtureTrace(name: string): AgentTrace {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../../fixtures/traces/${name}`, import.meta.url), 'utf8'),
  );
  const trace = parseTrace(raw);
  if (!trace) throw new Error(`${name} is not a trace this version can read`);
  return trace;
}
