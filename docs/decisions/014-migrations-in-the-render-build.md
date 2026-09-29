# 014: Migrations run in Render's build step

- Status: accepted
- Date: 2026-09-29
- Phase: launch

## Context

The schema comes from numbered SQL files in `apps/server/src/db/migrations`, applied by
`db/migrate.ts` and recorded in `schema_migrations`, so re-running is a no-op. Something has to run
them against the production database (its own Neon branch) before a new server version starts.

Render's pre-deploy command, the step made for this, is only available on paid instances. The
server runs on a free one. Render's dashboard variables, `DATABASE_URL` included, are available
during the build as well as at runtime.

## Decision

The build command ends with `node apps/server/dist/db/migrate.js`, the migration runner as tsup
built it. It runs once per deploy, against whatever `DATABASE_URL` the service has, before the new
version replaces the old one. The connection string stays in Render; nobody runs migrations
against production from a laptop.

## Alternatives

- **In the start command** (`migrate && start`). It would run on every start, and a free instance
  starts after every sleep, so each wake-up would also wait for Neon's compute and the migration
  query.
- **Run by hand** with the production connection string in a local `.env`. It puts the production
  secret on a laptop, where `npm run dev` would also pick it up, and a deploy can go out before
  anyone remembers to migrate.
- **A paid instance** for the pre-deploy command. It costs money for one step a deploy.

## Consequences

- A failed migration fails the build, so the previous version keeps serving and the deploy log
  names the migration.
- A migration commits before the new version is live, and if the rest of the deploy fails, the
  old version runs on the new schema. Every migration must work with the version still running:
  add columns and tables; rename or drop only in a later migration, once no running version reads
  the old shape.
- Migrations go through Neon's pooled endpoint, which runs PgBouncer in transaction mode. Each
  file runs inside one transaction, so a statement that cannot run in a transaction (such as
  `create index concurrently`) needs a different runner.
