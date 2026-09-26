/**
 * Starter projects as plain file maps. The server builds a project's initial
 * Y.Doc from one of these; nothing here knows about Yjs.
 *
 * Phase 1 is a single-file experience, so every template has exactly one file.
 * Phase 2 adds package.json and folders to the same structure.
 */
import { expressApiIndexJs } from './express-api.js';
import { blankNodeIndexJs } from './blank-node.js';

export const TEMPLATE_IDS = ['express-api', 'blank-node'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export type TemplateFile = {
  /** File name at the project root. Phase 2 adds nested paths. */
  name: string;
  content: string;
};

export type Template = {
  id: TemplateId;
  label: string;
  description: string;
  /** Non-empty; the first file is the one a new visitor opens. */
  files: readonly [TemplateFile, ...TemplateFile[]];
};

export const TEMPLATES: Readonly<Record<TemplateId, Template>> = {
  'express-api': {
    id: 'express-api',
    label: 'Express API',
    description: 'A small REST API you can run in your browser later.',
    files: [{ name: 'index.js', content: expressApiIndexJs }],
  },
  'blank-node': {
    id: 'blank-node',
    label: 'Blank Node',
    description: 'An empty Node.js file to start from.',
    files: [{ name: 'index.js', content: blankNodeIndexJs }],
  },
};

export function getTemplate(id: TemplateId): Template {
  return TEMPLATES[id];
}

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}
