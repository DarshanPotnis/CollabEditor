import { Router } from 'express';
import { formatPost } from '../lib/format.js';

const posts = [
  { id: 1, title: 'Notes on the Analytical Engine', authorId: 1, createdAt: '2026-03-01' },
  { id: 2, title: 'Compilers for everyone', authorId: 2, createdAt: '2026-03-09' },
];

export const postsRouter = Router();

postsRouter.get('/', (req, res) => {
  const newestFirst = [...posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(newestFirst.map(formatPost));
});
