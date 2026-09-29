/**
 * The demo recording against today's file tools: it must replay with no
 * divergence, or "Watch a demo" would stop in front of a visitor. The run
 * tools here hand back what was recorded, in order; the evals replay the demo
 * through the real run tools in Docker (apps/evals, fixture-replays).
 */
import { agentOrigin, createAgentUndo, createProjectUpdate } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { RuntimeTools } from '../compose-tool-host.js';
import { composeToolHost } from '../compose-tool-host.js';
import { createDocTools } from '../doc-tools/file-tools.js';
import { createFakeClock } from '../fake-clock.js';
import { runAgent } from '../loop.js';
import { agentInputs, startingProject } from '../session-inputs.js';
import { createStopSource } from '../stop-source.js';
import { fixtureTrace } from '../test/fixture-trace.js';
import { drive } from '../test/support.js';
import type { AgentTrace } from '../trace.js';
import { instantTypist } from '../typist.js';
import { createReplayModel } from './replay-model.js';
import { createReplayMonitor } from './replay-monitor.js';

const RUN_TOOLS = new Set([
  'run_project',
  'stop_project',
  'read_terminal',
  'http_request',
  'run_command',
]);

/** The recorded run tool results, handed back in order. */
function recordedRuntime(trace: AgentTrace): RuntimeTools {
  const results = trace.steps
    .flatMap((step) => step.toolCalls)
    .filter((call) => RUN_TOOLS.has(call.toolName));
  return {
    execute: (call) => {
      const next = results.shift();
      if (next?.toolName !== call.name) throw new Error(`no recorded ${call.name} left`);
      return Promise.resolve({ ok: !next.isError, output: next.output });
    },
  };
}

async function replay(trace: AgentTrace) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, createProjectUpdate({ name: 'Demo', template: 'express-api' }).update);
  const origin = agentOrigin('replay-1');
  const clock = createFakeClock(1_000);
  const monitor = createReplayMonitor(trace);
  const stop = createStopSource();
  const tools = composeToolHost(
    createDocTools({
      doc,
      origin,
      actor: { userId: 'agent-replay-1', userName: 'AI teammate (replay)' },
      undo: createAgentUndo(doc, origin),
      presence: { hostUserId: 'host', selfClientId: doc.clientID, peers: () => [] },
      typist: instantTypist,
      now: clock.now,
    }),
    recordedRuntime(trace),
  );
  const run = runAgent({
    sessionId: 'replay-1',
    inputs: agentInputs(doc, trace.inputs.goal, true),
    tier: trace.tier,
    model: createReplayModel(trace, clock),
    tools,
    clock,
    stop: stop.signal,
    project: startingProject(doc),
    onEvent: (event) => {
      if (monitor.observe(event)) stop.stop();
    },
  });
  const result = await drive(clock, run);
  return { result, divergence: monitor.divergence() };
}

describe('replaying a recording through today’s file tools', () => {
  it('plays the demo recording with no divergence, and its four checks verified again', async () => {
    const demo = fixtureTrace('demo-agent-5.json');
    const { result, divergence } = await replay(demo);
    expect(divergence).toBeNull();
    expect(result.outcome).toEqual(demo.outcome);
    expect(result.outcome).toMatchObject({ checks: { notMade: [] } });
  });

  it('stops the old demo where its refused edit now lands', async () => {
    const { result, divergence } = await replay(fixtureTrace('successful-demo.json'));
    expect(divergence).toMatchObject({
      step: 3,
      toolName: 'edit_file',
      recorded: expect.stringMatching(/^error: routes\/users\.js: The text to replace/) as unknown,
      now: expect.stringMatching(/^edited lines /) as unknown,
    });
    expect(result.outcome).toEqual({ kind: 'stopped' });
  });
});
