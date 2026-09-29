/** npm run evals:readme: rewrites the README's eval table from docs/evals/results. */
import { updateReadme } from './results/readme.js';

updateReadme().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
