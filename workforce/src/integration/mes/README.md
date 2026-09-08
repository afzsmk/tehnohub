# Workforce ↔ MES integration

This module is the anti-corruption layer between Workforce (APS) and the future MES.

## Direction

Workforce publishes a versioned production plan. MES imports that publication using the `planId + version` identity and the `Idempotency-Key` header.

MES later returns execution actuals through `MesActualReport`; Workforce must not change the monthly plan automatically from those actuals.

## Backward compatibility

`externalId` is optional in the persisted Workforce master data. `normalizeScenario()` fills it from the existing internal `id` when it is absent, so existing scenarios remain valid while integration clients can migrate to business master-data codes later.

## Publication lifecycle

`preparePublication()` creates or reuses a stable `planId`, increments the publication version, creates a deterministic idempotency key, builds the DTO, and validates it before transport.

The caller should persist the returned `publication` into the scenario only after MES confirms acceptance.

## Transport

`MesApiClient` uses:

`POST /api/v1/integrations/workforce/plans`

and sends `Idempotency-Key: workforce:plan:<planId>:v<version>`.

The integration layer intentionally contains no production-task, downtime, maintenance, operator-state, or Gantt logic. Those belong to MES.
