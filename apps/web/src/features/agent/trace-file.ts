/**
 * A trace file someone opened in the trace viewer. It is untrusted input like
 * any other: a size cap, JSON, and the core's parseTrace, which validates it
 * and reads every format there has been. The viewer shows which format it was
 * recorded in, since older ones recorded less.
 */
import { parseTrace, type AgentTrace } from '@collabcode/agent';

export const TRACE_FILE_MAX_BYTES = 5 * 1024 * 1024;

export type TraceFile =
  { ok: true; trace: AgentTrace; format: number } | { ok: false; message: string };

export function traceFromText(text: string): TraceFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // The reason is always the same for the person: it is not JSON.
    return { ok: false, message: 'This file is not JSON, so it is not a trace.' };
  }
  const trace = parseTrace(raw);
  if (!trace) {
    return {
      ok: false,
      message:
        'This file is not a CollabCode agent trace, or it is from a newer version of CollabCode.',
    };
  }
  const recorded = (raw as { version?: unknown }).version;
  return { ok: true, trace, format: typeof recorded === 'number' ? recorded : trace.version };
}

export async function readTraceFile(file: Pick<File, 'size' | 'text'>): Promise<TraceFile> {
  if (file.size > TRACE_FILE_MAX_BYTES) {
    return { ok: false, message: 'This file is too big to be a trace (at most 5 MB).' };
  }
  return traceFromText(await file.text());
}
