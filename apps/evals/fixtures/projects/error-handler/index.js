// A small Express API.
// Click Run to start it in your browser, then try it from the API tab.
import express from 'express';
import { usersRouter } from './routes/users.js';

const app = express();
app.use(express.json());
app.use('/users', usersRouter);

app.get('/', (req, res) => {
  res.json({ ok: true, routes: ['GET /users', 'POST /users'] });
});

app.get('/boom', () => {
  throw new Error('kaboom in the payments module');
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
