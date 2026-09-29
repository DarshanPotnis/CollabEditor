import { createProjectUpdate, readFileText, resolveDocTree } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { startingProject } from '../session-inputs.js';
import { fixtureTrace } from '../test/fixture-trace.js';
import type { AgentTrace } from '../trace.js';
import { planReplay } from './replay-plan.js';

function freshProject(template: 'express-api' | 'blank-node' = 'express-api'): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, createProjectUpdate({ name: 'Demo', template }).update);
  return doc;
}

const demo = fixtureTrace('demo-agent-5.json');

describe('planReplay', () => {
  it('plays the demo recording on a fresh project from its template', () => {
    expect(planReplay(demo, startingProject(freshProject()))).toEqual({
      ok: true,
      goal: 'Add a DELETE /users/:id endpoint with validation: 204 when deleted, 404 when there is no such user, 400 for an id that is not a number.',
      recordedAt: demo.startedAt,
      prompt: 'agent@5',
      model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
      steps: 4,
    });
  });

  it('refuses another template, or starting files that differ from the recording’s', () => {
    expect(planReplay(demo, startingProject(freshProject('blank-node')))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('made on the express-api template') as unknown,
    });
    const changed = freshProject();
    const id = resolveDocTree(changed).idByPath.get('index.js');
    if (id === undefined) throw new Error('no index.js');
    readFileText(changed, id)?.insert(0, '// changed\n');
    expect(planReplay(demo, startingProject(changed))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('the recording needs making again') as unknown,
    });
  });

  it('refuses a recording that did not finish, or whose model did not answer a step', () => {
    const project = startingProject(freshProject());
    const capped: AgentTrace = {
      ...demo,
      outcome: { kind: 'limit', limit: 'steps', message: 'used all 15 steps' },
    };
    expect(planReplay(capped, project)).toMatchObject({ ok: false });
    const unanswered: AgentTrace = {
      ...demo,
      steps: demo.steps.map((step, index) => (index === 1 ? { ...step, model: null } : step)),
    };
    expect(planReplay(unanswered, project)).toEqual({
      ok: false,
      reason:
        'The model did not answer step 2 of this recording, so it cannot be played as a demo.',
    });
  });
});
