import { Router } from 'express';
import { formatPost } from '../lib/format.js';

const posts = [
  { id: 1, title: 'Notes on the Analytical Engine', authorId: 1, created: '2026-03-01' },
  { id: 2, title: 'Compilers for everyone', authorId: 2, created: '2026-03-09' },
];

export const postsRouter = Router();

postsRouter.get('/', (req, res) => {
  const newestFirst = [...posts].sort((a, b) => b.created.localeCompare(a.created));
  res.json(newestFirst.map(formatPost));
});
