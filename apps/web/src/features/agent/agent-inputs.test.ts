import { AGENT_INPUT_LIMITS, PROMPTS, createFile, createProjectUpdate } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { agentInputs, startingProject } from './agent-inputs.js';

function project(): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, createProjectUpdate({ name: 'Demo', template: 'express-api' }).update);
  return doc;
}

describe('agentInputs', () => {
  it('lists the files, sorted, in the form the agent prompt accepts', () => {
    const inputs = agentInputs(project(), 'Add a route');
    expect(inputs).toEqual({
      goal: 'Add a route',
      files: ['index.js', 'package.json', 'routes/users.js'],
      moreFiles: 0,
    });
    expect(PROMPTS.agent.prepare(inputs).ok).toBe(true);
  });

  it('leaves out what does not fit, and says how many', () => {
    const doc = project();
    const actor = { userId: 'a', userName: 'A' };
    for (let index = 0; index < 300; index += 1) {
      createFile(doc, { parentId: null, name: `${'x'.repeat(90)}-${String(index)}.js` }, actor);
    }
    const inputs = agentInputs(doc, 'Tidy up');
    expect(inputs.files.join('\n').length).toBeLessThanOrEqual(AGENT_INPUT_LIMITS.fileListChars);
    expect((inputs.moreFiles ?? 0) + inputs.files.length).toBe(303);
    expect(PROMPTS.agent.prepare(inputs).ok).toBe(true);
  });
});

describe('startingProject', () => {
  it('names the template and fingerprints the files', () => {
    const a = startingProject(project());
    expect(a.template).toBe('express-api');
    expect(startingProject(project()).filesFingerprint).toBe(a.filesFingerprint);
  });
});
