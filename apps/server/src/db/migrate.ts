/**
 * Plain numbered SQL migrations, applied in filename order and recorded in
 * schema_migrations so re-running is a no-op. Run on deploy, before start.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { createSqlClient, type Sql } from './client.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations(sql: Sql, log: (name: string) => void): Promise<string[]> {
  await sql`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
  const applied = new Set(
    (await sql<{ name: string }[]>`select name from schema_migrations`).map((row) => row.name),
  );

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const statements = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(statements);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    log(file);
    ran.push(file);
  }
  return ran;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === 'development');
  const sql = createSqlClient(config.DATABASE_URL);
  try {
    const ran = await runMigrations(sql, (name) => logger.info({ migration: name }, 'applied'));
    logger.info({ applied: ran.length }, 'migrations up to date');
  } finally {
    await sql.end();
  }
}

// Only runs when this file is the entry point, not when imported by a test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    createLogger('info', false).fatal({ err: error }, 'migration failed');
    process.exitCode = 1;
  });
}
