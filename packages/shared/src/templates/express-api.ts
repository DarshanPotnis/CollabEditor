import type { TemplateFile } from './types.js';

const packageJson = `{
  "name": "express-api",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "node --watch index.js",
    "start": "node index.js"
  },
  "dependencies": {
    "express": "^5.2.1"
  }
}
`;

const indexJs = `// A small Express API.
// Click Run to start it in your browser, then try it from the API tab.
import express from 'express';
import { usersRouter } from './routes/users.js';

const app = express();
app.use(express.json());
app.use('/users', usersRouter);

app.get('/', (req, res) => {
  res.json({ ok: true, routes: ['GET /users', 'POST /users'] });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(\`API listening on http://localhost:\${port}\`);
});
`;

const usersJs = `import { Router } from 'express';

const users = [
  { id: 1, name: 'Ada Lovelace', role: 'engineer' },
  { id: 2, name: 'Grace Hopper', role: 'engineer' },
];

export const usersRouter = Router();

usersRouter.get('/', (req, res) => {
  res.json(users);
});

usersRouter.post('/', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (name === '') {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const user = { id: users.length + 1, name, role: req.body?.role ?? 'member' };
  users.push(user);
  res.status(201).json(user);
});
`;

export const expressApiFiles: readonly [TemplateFile, ...TemplateFile[]] = [
  { path: 'index.js', content: indexJs },
  { path: 'package.json', content: packageJson },
  { path: 'routes/users.js', content: usersJs },
];
