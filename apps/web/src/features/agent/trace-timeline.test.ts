import { readFileSync } from 'node:fs';
import { parseTrace, type AgentTrace } from '@collabcode/agent';
import { describe, expect, it } from 'vitest';
import { readTraceFile, traceFromText, TRACE_FILE_MAX_BYTES } from './trace-file.js';
import { traceTimeline } from './trace-timeline.js';

function recording(name: string): string {
  return readFileSync(
    new URL(`../../../../../packages/agent/fixtures/traces/${name}`, import.meta.url),
    'utf8',
  );
}

function parsed(name: string): AgentTrace {
  const trace = parseTrace(JSON.parse(recording(name)));
  if (!trace) throw new Error(`${name} is not a trace`);
  return trace;
}

describe('traceTimeline', () => {
  const timeline = traceTimeline(parsed('demo-agent-5.json'));

  it('heads the timeline with the goal, the prompt, model and tier, and the totals', () => {
    expect(timeline.header.goal).toMatch(/^Add a DELETE \/users\/:id endpoint with validation/);
    expect(timeline.header.lines[0]).toBe(
      'agent@5 · gemini/gemini-3.5-flash-lite · shared tier (up to 15 steps)',
    );
    expect(timeline.header.lines[1]).toMatch(
      /^Started 2026-09-29 \d\d:\d\d UTC · 4 steps · [\d,]+ tokens · 18\.7 s$/,
    );
  });

  it('shows each step’s model call and tool calls, with tokens, latency and truncated output', () => {
    expect(timeline.steps).toHaveLength(4);
    const [first, second, third] = timeline.steps;
    expect(first?.model).toMatch(
      /^gemini\/gemini-3\.5-flash-lite · 2\.0 s · [\d,]+ in, [\d,]+ out · tool-calls \(STOP\)$/,
    );
    expect(first?.calls.map((call) => call.name)).toEqual(['run_project']);
    expect(second?.calls[0]).toMatchObject({ name: 'edit_file', isError: false });
    expect(second?.calls[0]?.output).toMatch(/^Edited routes\/users\.js \(changed lines/);
    expect(third?.calls.map((call) => `${call.name} ${call.output.split(',')[0] ?? ''}`)).toEqual([
      'http_request HTTP 400 Bad Request',
      'http_request HTTP 404 Not Found',
      'http_request HTTP 204 No Content',
      'http_request HTTP 200 OK',
    ]);
  });

  it('ends with the summary and the verified checks', () => {
    expect(timeline.end.outcome).toBe('Finished');
    expect(timeline.end.summary).toMatch(/^Added the DELETE \/users\/:id endpoint/);
    expect(timeline.end.checks).toEqual({
      made: [
        'DELETE /users/abc → 400',
        'DELETE /users/999 → 404',
        'DELETE /users/1 → 204',
        'GET /users → 200',
      ],
      notMade: [],
    });
  });

  it('reads an old format, saying what it did not record', () => {
    const old = traceTimeline(parsed('model-busy-mid-session.json'));
    expect(old.header.lines[0]).toMatch(/^agent@1 · /);
    expect(old.steps.flatMap((step) => step.waits)).toContain(
      'Busy: waited 5.4 s (the attempt’s own time was not recorded)',
    );
    expect(old.end.checks).toBeNull();
    expect(old.end.outcome).toMatch(/busy/i);
  });

  it('cuts long inputs and outputs, saying how much is left out', () => {
    const long = parsed('demo-agent-5.json');
    const step = long.steps[1];
    const call = step?.toolCalls[0];
    if (!step || !call) throw new Error('no second step');
    const huge = {
      ...long,
      steps: [{ ...step, toolCalls: [{ ...call, output: 'x'.repeat(5_000) }] }],
    };
    const output = traceTimeline(huge).steps[0]?.calls[0]?.output ?? '';
    expect(output).toMatch(/…\n\(\d[\d,]* more characters\)$/);
    expect(output.length).toBeLessThan(2_000);
  });
});

describe('reading a trace file', () => {
  it('reads every format, and says which it was recorded in', () => {
    expect(traceFromText(recording('model-busy-mid-session.json'))).toMatchObject({
      ok: true,
      format: 1,
    });
    expect(traceFromText(recording('successful-demo.json'))).toMatchObject({ ok: true, format: 3 });
    expect(traceFromText(recording('demo-agent-5.json'))).toMatchObject({ ok: true, format: 4 });
  });

  it('refuses what is not a trace, and a file too big to be one', async () => {
    expect(traceFromText('not json')).toEqual({
      ok: false,
      message: 'This file is not JSON, so it is not a trace.',
    });
    expect(traceFromText('{"format":"collabcode-agent-trace","version":9}')).toEqual({
      ok: false,
      message:
        'This file is not a CollabCode agent trace, or it is from a newer version of CollabCode.',
    });
    await expect(
      readTraceFile({ size: TRACE_FILE_MAX_BYTES + 1, text: () => Promise.resolve('{}') }),
    ).resolves.toEqual({
      ok: false,
      message: 'This file is too big to be a trace (at most 5 MB).',
    });
  });
});
