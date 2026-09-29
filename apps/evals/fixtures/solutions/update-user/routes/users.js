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

const ROLES = ['engineer', 'member'];

usersRouter.put('/:id', (req, res) => {
  const user = users.find((candidate) => candidate.id === Number(req.params.id));
  if (user === undefined) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  const { name, role } = req.body ?? {};
  if (name !== undefined && (typeof name !== 'string' || name.trim() === '' || name.trim().length > 50)) {
    res.status(400).json({ error: 'name must be 1 to 50 characters' });
    return;
  }
  if (role !== undefined && !ROLES.includes(role)) {
    res.status(400).json({ error: 'role must be engineer or member' });
    return;
  }
  if (name !== undefined) user.name = name.trim();
  if (role !== undefined) user.role = role;
  res.json(user);
});
