# Workforce → MES transport

`mes-publish` is the authenticated Workforce entry point for publishing an immutable Workforce plan snapshot to MES.

## Runtime boundary

1. The Workforce browser calls `mes-publish` with the current authenticated user session.
2. `mes-publish` validates the Workforce user JWT.
3. `mes-publish` sends the published plan to the MES `workforce-import` Edge Function using the `x-workforce-integration-secret` header.
4. MES validates that secret and invokes `mes_import_workforce_plan` with its `service_role` client.
5. The database import RPC is not executable by `anon` or `authenticated` and is restricted to `service_role`.

The browser never receives or stores the integration secret.

## Secret name

The canonical Workforce-side secret name is `WORKFORCE_INGEST_SECRET`.

For backward-compatible rotation, `mes-publish` currently accepts the previous `MES_INGEST_SECRET` name as a fallback. New deployments should use `WORKFORCE_INGEST_SECRET` and retire the legacy name after verification.

The MES side reads `WORKFORCE_INGEST_SECRET`.

## Deployment

Production deployment of `mes-publish` is managed by `.github/workflows/workforce-supabase-functions.yml` using the `workforce-production` environment and the non-secret Workforce project ref `cihzyokqrjpmzoiezmwc`.

The workflow is triggered by changes under `workforce/supabase/functions/mes-publish/`, the Workforce Supabase config, or the workflow itself, and can also be started manually.
