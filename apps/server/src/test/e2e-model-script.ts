/**
 * What the model answers in the end-to-end suite: scripted by prompt, and by
 * markers a test puts in the code, so a test can ask for a slow answer or a
 * refused key with no network and no real model. e2e/ai.spec.ts and
 * e2e/agent.spec.ts repeat the marker strings; keep them in step.
 */
import { conversationSteps, fencedBlocks } from '@collabcode/shared';
import type { ModelCall } from '../ai/model-gateway.js';
import { toolCallReply, type FakeReply } from './fake-model-gateway.js';

/** An own key the fake provider refuses, the way a real one refuses a bad key. */
const E2E_REFUSED_KEY = 'sk-e2e-refused-0000';
/** Code containing this gets an answer that streams slowly enough to stop. */
const E2E_SLOW_MARKER = 'e2e-slow-answer';
/** What the fake model appends to the first line of the code it edits. */
const E2E_EDIT_MARK = ' // edited by AI';

const E2E_EXPLANATION = 'This code is explained by the fake model.';

function editedSelection(content: string): string {
  // The first fenced block of an edit prompt is the selection to replace.
  const [selection] = fencedBlocks(content);
  const [first = '', ...rest] = (selection?.content ?? '').split('\n');
  return [`${first}${E2E_EDIT_MARK}`, ...rest].join('\n');
}

/** An AI teammate goal containing this answers slowly enough to stop. */
const E2E_SLOW_AGENT = 'e2e-slow-agent';
/** The route the scripted AI teammate adds to the Express template. */
const E2E_AGENT_ROUTE = "usersRouter.delete('/:id', (req, res) => {";
const USERS_ROUTER = 'export const usersRouter = Router();\n';

/** An AI teammate goal containing this finds the model busy once, before its first step. */
const E2E_BUSY_AGENT = 'e2e-busy-agent';
/** Goals that have had their busy answer, so the retry succeeds. */
const busyOnce = new Set<string>();

/** An AI teammate goal containing this edits, runs the project and calls it. */
const E2E_RUN_AGENT = 'e2e-run-agent';
const DELETE_ROUTE = [
  "usersRouter.delete('/:id', (req, res) => {",
  '  const index = users.findIndex((user) => user.id === Number(req.params.id));',
  '  if (index === -1) {',
  "    res.status(404).json({ error: 'user not found' });",
  '    return;',
  '  }',
  '  users.splice(index, 1);',
  '  res.status(204).end();',
  '});',
].join('\n');

/** The demo, scripted: add the route, run the project, call it, report what it answered. */
function runningAgentReply(call: ModelCall): FakeReply {
  const conversation = call.toolUse?.conversation ?? [];
  switch (conversationSteps(conversation)) {
    case 0:
      return toolCallReply([
        {
          toolName: 'edit_file',
          input: {
            path: 'routes/users.js',
            oldText: USERS_ROUTER,
            newText: `${USERS_ROUTER}\n${DELETE_ROUTE}\n`,
          },
        },
      ]);
    case 1:
      return toolCallReply([{ toolName: 'run_project', input: {} }]);
    case 2:
      return toolCallReply([
        { toolName: 'http_request', input: { method: 'DELETE', path: '/users/1' } },
      ]);
    default: {
      const last = conversation.at(-1);
      const answer = last?.role === 'tool' ? (last.results[0]?.output ?? '') : '';
      const status = /^HTTP (\d+)/.exec(answer)?.[1] ?? 'nothing';
      return toolCallReply([
        { toolName: 'finish', input: { summary: `DELETE /users/1 answered ${status}.` } },
      ]);
    }
  }
}

/**
 * The AI teammate, on the Express template: read the users route, add a
 * DELETE route to it, finish. The same three steps every time.
 */
function agentReply(call: ModelCall): FakeReply {
  const goal = call.messages.map((message) => message.content).join('\n');
  if (goal.includes(E2E_SLOW_AGENT)) {
    const chunks = Array.from({ length: 60 }, (_, index) => `Thinking ${String(index + 1)}. `);
    return { kind: 'text', chunks, delayMs: 250 };
  }
  if (goal.includes(E2E_RUN_AGENT)) return runningAgentReply(call);
  if (goal.includes(E2E_BUSY_AGENT) && !busyOnce.has(goal)) {
    busyOnce.add(goal);
    return { kind: 'fail', failure: 'unavailable', statusCode: 503 };
  }
  switch (conversationSteps(call.toolUse?.conversation ?? [])) {
    case 0:
      return toolCallReply(
        [{ toolName: 'read_file', input: { path: 'routes/users.js' } }],
        'Let me look at the users route.',
      );
    case 1:
      return toolCallReply([
        {
          toolName: 'edit_file',
          input: {
            path: 'routes/users.js',
            oldText: USERS_ROUTER,
            newText: `${USERS_ROUTER}\n${E2E_AGENT_ROUTE}\n  res.status(204).end();\n});\n`,
          },
        },
      ]);
    default:
      return toolCallReply([
        { toolName: 'finish', input: { summary: 'Added DELETE /users/:id to routes/users.js.' } },
      ]);
  }
}

export function e2eModelReply(call: ModelCall): FakeReply {
  if (call.target.apiKey === E2E_REFUSED_KEY) {
    return { kind: 'fail', failure: 'invalid-key', statusCode: 401 };
  }
  if (call.toolUse) return agentReply(call);
  const content = call.messages.map((message) => message.content).join('\n');
  if (content.includes(E2E_SLOW_MARKER)) {
    const chunks = Array.from({ length: 60 }, (_, index) => `Part ${String(index + 1)}. `);
    return { kind: 'text', chunks, delayMs: 250 };
  }
  if (call.system.startsWith('You edit code')) {
    return { kind: 'text', chunks: ['```js\n', `${editedSelection(content)}\n`, '```'] };
  }
  // Two chunks, so the answer streams.
  const middle = E2E_EXPLANATION.indexOf(' by ');
  return {
    kind: 'text',
    chunks: [E2E_EXPLANATION.slice(0, middle), E2E_EXPLANATION.slice(middle)],
  };
}
