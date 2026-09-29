import { Router } from 'express';
import { formatUser } from '../lib/format.js';

const users = [
  { id: 1, name: 'Ada Lovelace', createdAt: '2026-01-05' },
  { id: 2, name: 'Grace Hopper', createdAt: '2026-02-11' },
];

export const usersRouter = Router();

usersRouter.get('/', (req, res) => {
  res.json(users.map(formatUser));
});
