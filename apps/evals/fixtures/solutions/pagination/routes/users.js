import { Router } from 'express';

const users = [
  { id: 1, name: 'Ada Lovelace', role: 'engineer' },
  { id: 2, name: 'Grace Hopper', role: 'engineer' },
];

export const usersRouter = Router();

/** A query parameter as a whole number from 0 to max, its fallback when absent, or null when invalid. */
function wholeNumber(value, fallback, max) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return number <= max ? number : null;
}

usersRouter.get('/', (req, res) => {
  const limit = wholeNumber(req.query.limit, 100, 100);
  const offset = wholeNumber(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
  if (limit === null || offset === null) {
    res.status(400).json({ error: 'limit must be a whole number up to 100, and offset a whole number' });
    return;
  }
  res.json(users.slice(offset, offset + limit));
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
