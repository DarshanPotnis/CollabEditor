import { Router } from 'express';
import { validateUser } from './validate.js';

const users = [
  { id: 1, name: 'Ada Lovelace', role: 'engineer' },
  { id: 2, name: 'Grace Hopper', role: 'engineer' },
];

export const usersRouter = Router();

usersRouter.get('/', (req, res) => {
  res.json(users);
});

usersRouter.post('/', (req, res) => {
  const result = validateUser(req.body);
  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }
  const user = { id: users.length + 1, name: result.name, role: result.role };
  users.push(user);
  res.status(201).json(user);
});
