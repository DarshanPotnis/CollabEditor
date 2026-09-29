import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { anchorSelection } from '../editor/selection-anchor.js';
import type { AiFinish, AiStep } from './ai-client.js';
import type { AiRequestState } from './ai-request-state.js';
import { editProposal, type EditTarget } from './edit-proposal.js';

const SELECTED = 'let b = 2;\n';

function target(): EditTarget {
  const ytext = new Y.Doc().getText('file');
  ytext.insert(0, `const a = 1;\n${SELECTED}`);
  const step: AiStep = {
    projectId: 'p1',
    promptId: 'edit-selection',
    inputs: {
      path: 'a.js',
      language: 'javascript',
      startLine: 2,
      selection: SELECTED,
      instruction: 'Use const.',
    },
  };
  return {
    step,
    fileId: 'f1',
    path: 'a.js',
    language: 'javascript',
    startLine: 2,
    anchor: anchorSelection(ytext, 13, 13 + SELECTED.length),
  };
}

function done(
  step: AiStep,
  text: string,
  finishReason: AiFinish['finishReason'] = 'stop',
): AiRequestState {
  return {
    phase: 'done',
    id: 1,
    step,
    text,
    finish: {
      type: 'finish',
      finishReason,
      usage: { inputTokens: 1, outputTokens: 1 },
      prompt: { id: 'edit-selection', version: 1 },
      model: { provider: 'gemini', id: 'gemini-3.5-flash-lite' },
      remainingToday: 10,
    },
  };
}

describe('editProposal', () => {
  it('offers the code from the answer, ending like the selection did', () => {
    const edit = target();
    const proposal = editProposal(done(edit.step, '```js\nconst b = 2;\n```'), edit);
    expect(proposal).toEqual({ kind: 'ready', target: edit, replacement: 'const b = 2;\n' });
  });

  it('has nothing to offer until the answer is complete', () => {
    const edit = target();
    const streaming: AiRequestState = { phase: 'streaming', id: 1, step: edit.step, text: '```js' };
    expect(editProposal(streaming, edit)).toEqual({ kind: 'none' });
    expect(editProposal({ phase: 'idle' }, edit)).toEqual({ kind: 'none' });
  });

  it('ignores an answer to a different request', () => {
    const edit = target();
    const other = { ...edit.step };
    expect(editProposal(done(other, '```js\nx\n```'), edit)).toEqual({ kind: 'none' });
    expect(editProposal(done(edit.step, '```js\nx\n```'), null)).toEqual({ kind: 'none' });
  });

  it('says so when the answer has no code', () => {
    const edit = target();
    expect(editProposal(done(edit.step, 'I cannot do that.'), edit)).toMatchObject({
      kind: 'unusable',
      message: 'The AI did not send back code. Try rephrasing the instruction.',
    });
  });

  it('says so when the AI left the code unchanged', () => {
    const edit = target();
    expect(editProposal(done(edit.step, '```js\nlet b = 2;\n```'), edit)).toMatchObject({
      kind: 'unusable',
      message: expect.stringContaining('unchanged') as unknown,
    });
  });

  it('refuses an answer that was cut off', () => {
    const edit = target();
    expect(editProposal(done(edit.step, '```js\nconst b\n```', 'length'), edit)).toMatchObject({
      kind: 'unusable',
      message: expect.stringContaining('cut off') as unknown,
    });
  });
});
