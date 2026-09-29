import { Router } from 'express';

const users = [
  { id: 1, name: 'Ada Lovelace', role: 'engineer' },
  { id: 2, name: 'Grace Hopper', role: 'engineer' },
];

export const usersRouter = Router();

usersRouter.get('/', (req, res) => {
  res.json(users);
});

const ROLES = ['engineer', 'member'];

usersRouter.post('/', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (name === '') {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (name.length > 50) {
    res.status(400).json({ error: 'name must be at most 50 characters' });
    return;
  }
  const role = req.body?.role ?? 'member';
  if (!ROLES.includes(role)) {
    res.status(400).json({ error: 'role must be engineer or member' });
    return;
  }
  const user = { id: users.length + 1, name, role };
  users.push(user);
  res.status(201).json(user);
});
