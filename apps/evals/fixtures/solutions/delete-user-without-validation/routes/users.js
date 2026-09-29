import { Router } from 'express';

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

usersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const index = users.findIndex((user) => user.id === id);
  if (index === -1) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  users.splice(index, 1);
  res.status(204).end();
});
