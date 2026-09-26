export const expressApiIndexJs = `// A small Express API.
// Phase 3 runs this inside your browser and lets you call it from the console.
import express from 'express';

const app = express();
app.use(express.json());

const users = [
  { id: 1, name: 'Ada Lovelace', role: 'engineer' },
  { id: 2, name: 'Grace Hopper', role: 'engineer' },
];

app.get('/users', (req, res) => {
  res.json(users);
});

app.post('/users', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (name === '') {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const user = { id: users.length + 1, name, role: req.body?.role ?? 'member' };
  users.push(user);
  res.status(201).json(user);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(\`API listening on http://localhost:\${port}\`);
});
`;
