import { Router } from 'express';

export const userByIdRouter = Router();

userByIdRouter.get('/:id', (req, res) => {
  res.status(404).json({ error: 'user not found' });
});
