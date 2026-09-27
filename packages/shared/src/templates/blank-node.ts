import type { TemplateFile } from './types.js';

const packageJson = `{
  "name": "blank-node",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch index.js",
    "start": "node index.js"
  }
}
`;

const indexJs = `// A blank Node.js project.
// Everyone who opens this project edits these files with you, live.

console.log('Hello from CollabCode');
`;

export const blankNodeFiles: readonly [TemplateFile, ...TemplateFile[]] = [
  { path: 'index.js', content: indexJs },
  { path: 'package.json', content: packageJson },
];
