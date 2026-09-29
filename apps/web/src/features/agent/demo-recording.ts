/**
 * "Watch a demo": the recording it plays, and the project it plays into. The
 * recording is the committed fixture (packages/agent/fixtures/traces), served
 * as a file of its own and fetched only when a demo starts, then read like any
 * trace file: validated, never trusted.
 */
import type { AgentTrace } from '@collabcode/agent';
import type { TemplateId } from '@collabcode/shared';
import recordingUrl from '../../../../../packages/agent/fixtures/traces/demo-agent-5.json?url';
import { traceFromText } from './trace-file.js';

export const DEMO = {
  /** The `demo` value in a project's link that opens it in replay mode. */
  id: 'delete-endpoint',
  template: 'express-api' satisfies TemplateId,
  /** Recognisable, so a later cleanup can find demo projects. */
  projectName: 'Demo — DELETE endpoint',
} as const;

export async function loadDemoRecording(): Promise<AgentTrace> {
  const response = await fetch(recordingUrl);
  if (!response.ok) {
    throw new Error(`The demo recording could not be loaded (HTTP ${String(response.status)}).`);
  }
  const read = traceFromText(await response.text());
  if (!read.ok) throw new Error(`The demo recording could not be read: ${read.message}`);
  return read.trace;
}
