/**
 * Postgres connection pool (Neon). One pool per process.
 */
import postgres from 'postgres';

export type Sql = postgres.Sql;

export function createSqlClient(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    // Neon's pooled endpoint runs pgbouncer in transaction mode, which does
    // not support named prepared statements.
    prepare: false,
  });
}
