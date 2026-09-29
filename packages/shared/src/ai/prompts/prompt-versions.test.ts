/**
 * Same prompt version, same prompt. Evals record `id@version` and compare runs
 * by it, so a prompt whose text or inputs change must get a new version.
 *
 * Each prompt is built from fixed inputs and hashed together with its input
 * schema and, for the agent, its tools as the model sees them and the
 * reminders it can be sent. If this fails after you edited a prompt on purpose, bump its
 * `version` and paste the new fingerprint below.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ConversationEntry } from '../conversation.js';
import { declareTools, type ReminderContext } from '../prompt.js';
import { PROMPTS, type PromptId } from './index.js';

const SAMPLE_INPUTS: Record<PromptId, unknown> = {
  'explain-selection': {
    path: 'src/app.js',
    language: 'javascript',
    startLine: 3,
    selection: 'app.get("/", handler);',
    before: 'const app = express();',
    after: 'app.listen(3000);',
  },
  'edit-selection': {
    path: 'src/app.js',
    language: 'javascript',
    startLine: 3,
    selection: 'app.get("/", handler);',
    instruction: 'Make the handler async',
    before: 'const app = express();',
    after: 'app.listen(3000);',
  },
  'explain-error': {
    outcome: 'exited',
    exitCode: 1,
    terminalOutput: 'Error: boom\n    at src/app.js:4:1',
    excerpt: {
      path: 'src/app.js',
      language: 'javascript',
      startLine: 3,
      code: 'app.get("/", handler);\nthrow new Error("boom");',
      focusLine: 4,
    },
  },
  agent: {
    goal: 'Add a DELETE /users/:id endpoint with validation.',
    files: ['index.js', 'package.json', 'routes/users.js'],
    moreFiles: 2,
    contents: [
      { path: 'index.js', content: "app.use('/users', usersRouter);\n" },
      { path: 'routes/users.js', content: 'export const usersRouter = Router();\n' },
    ],
    sandbox: 'unavailable',
  },
};

/** One refused call made twice, so every reminder's words are in the fingerprint. */
const REFUSED: ConversationEntry[] = [
  {
    role: 'assistant',
    parts: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'run_project', input: {} }],
  },
  {
    role: 'tool',
    results: [{ toolCallId: 'c1', toolName: 'run_project', isError: true, output: 'No.' }],
  },
];
const REMINDER_SAMPLES: ReminderContext[] = [3, 2, 1].map((stepsLeft) => ({
  conversation: [...REFUSED, ...REFUSED],
  stepsLeft,
}));

const EXPECTED: Record<PromptId, { version: number; fingerprint: string }> = {
  'explain-selection': { version: 1, fingerprint: '3dda3dea2c866373' },
  'edit-selection': { version: 1, fingerprint: '12d771944879e728' },
  'explain-error': { version: 2, fingerprint: '4ed6c3d63748c820' },
  agent: { version: 4, fingerprint: '35556476befb7454' },
};

function fingerprint(id: PromptId): string {
  const prompt: (typeof PROMPTS)[PromptId] = PROMPTS[id];
  const prepared = prompt.prepare(SAMPLE_INPUTS[id]);
  if (!prepared.ok) throw new Error(`sample inputs for ${id} are invalid: ${prepared.message}`);
  const toolUse = 'toolUse' in prompt ? prompt.toolUse : undefined;
  const material = JSON.stringify({
    prompt: prepared.prompt,
    maxOutputTokens: prompt.maxOutputTokens,
    inputs: z.toJSONSchema(prompt.inputs, { io: 'input' }),
    // Absent for prompts without tools, so their fingerprints are unchanged.
    toolUse: toolUse && {
      ...toolUse,
      tools: declareTools(toolUse.tools),
      reminders: REMINDER_SAMPLES.map((context) => toolUse.remind?.(context) ?? null),
    },
  });
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

describe('prompt versions', () => {
  it.each(Object.keys(EXPECTED) as PromptId[])('%s changes only with a new version', (id) => {
    expect(
      { version: PROMPTS[id].version, fingerprint: fingerprint(id) },
      `${id} changed: bump its version and update its fingerprint in this file`,
    ).toEqual(EXPECTED[id]);
  });
});
