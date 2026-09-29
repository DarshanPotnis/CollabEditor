/**
 * Starter projects. The server builds a project's initial Y.Doc from one of
 * these (ops.ts); Phase 3 runs them, which is why each has a package.json
 * whose dev script uses `node --watch`.
 *
 * They run in a WebContainer, whose Node is 22 (22.22 when Phase 3 was built),
 * not the Node 24 this repository uses. Template code may only use what Node
 * 22 has, and each package.json says so with `engines`.
 */
import { blankNodeFiles } from './blank-node.js';
import { expressApiFiles } from './express-api.js';
import { TEMPLATE_IDS, type Template, type TemplateId } from './types.js';

export { TEMPLATE_IDS, type Template, type TemplateFile, type TemplateId } from './types.js';

export const TEMPLATES: Readonly<Record<TemplateId, Template>> = {
  'express-api': {
    id: 'express-api',
    label: 'Express API',
    description: 'A small REST API you can run and call right in your browser.',
    files: expressApiFiles,
    entryPath: 'index.js',
  },
  'blank-node': {
    id: 'blank-node',
    label: 'Blank Node',
    description: 'An empty Node.js project to start from.',
    files: blankNodeFiles,
    entryPath: 'index.js',
  },
};

export function getTemplate(id: TemplateId): Template {
  return TEMPLATES[id];
}

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}
