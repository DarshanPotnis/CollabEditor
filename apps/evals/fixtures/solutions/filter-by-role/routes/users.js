import { Router } from 'express';

const users = [
  { id: 1, name: 'Ada Lovelace', role: 'engineer' },
  { id: 2, name: 'Grace Hopper', role: 'engineer' },
];

export const usersRouter = Router();

const ROLES = ['engineer', 'member'];

usersRouter.get('/', (req, res) => {
  const { role } = req.query;
  if (role === undefined) {
    res.json(users);
    return;
  }
  if (!ROLES.includes(role)) {
    res.status(400).json({ error: 'role must be engineer or member' });
    return;
  }
  res.json(users.filter((user) => user.role === role));
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
