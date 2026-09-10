# MES production migration release

Production MES database is the dedicated Supabase project `caeqoipshdtxezcurnkn`.

The repository is the source of truth for `mes/supabase/migrations`. The production database is updated only through the controlled GitHub Actions workflow `.github/workflows/mes-supabase-production.yml`.

## One-time GitHub configuration

Add these repository or `mes-production` environment secrets in GitHub Actions:

- `SUPABASE_ACCESS_TOKEN` — Supabase personal access token used by the CLI for Management API access.
- `SUPABASE_DB_PASSWORD` — password for the production Postgres database.

Do not commit either secret to the repository.

## Release procedure

1. Merge the migration change into `main`.
2. The normal CI must pass the local migration reset, database security regression tests, schema lint, application tests, and builds.
3. Open **Actions → MES Supabase Production Release → Run workflow**.
4. The workflow links the repository to the dedicated production project, shows the remote/local migration state, performs a dry run, and then executes `supabase db push --linked`.
5. The workflow finishes by listing the migration state again so the remote history can be audited.

Supabase records applied migrations in `supabase_migrations.schema_migrations`. `db push` applies only migrations that are not already recorded there; do not use `db reset --linked` against production.

## Migration history reconciliation

If a migration was already executed outside the normal CLI flow and the SQL is known to be present in production, reconcile the history with `supabase migration repair --status applied <timestamp>` instead of executing the migration a second time. Verify the production schema first.

The temporary MES HTTP bootstrap mechanism used during initial provisioning is historical and is no longer part of the runtime release path. New MES schema changes must be committed as ordinary migration files and released through the production workflow.
