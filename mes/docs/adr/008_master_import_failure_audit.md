# ADR-008 — Preserve failed master-data import attempts

- Status: Accepted
- Scope: MES master-data bootstrap import

## Decision

A bootstrap import creates its `mes_master_import_runs` record before the data-write phase. The actual upserts run inside a nested PL/pgSQL exception block. On any runtime error, the nested block rolls back the master-data mutations while the outer transaction keeps the import-run row and marks it `FAILED` with the captured SQL error.

## Rationale

Import history is operational evidence. A failed import must remain visible to administrators instead of disappearing because the same exception rolled back the history row. The data mutation itself remains atomic: a failed write phase must not leave a partial bootstrap applied.

## Consequences

- `COMPLETED` imports remain all-or-nothing.
- Runtime failures produce a persistent `FAILED` import record.
- Validation failures that occur before the run is created remain rejected without a run record; these are deterministic input validation errors and do not mutate data.
- The UI can distinguish validation rejection from a runtime import failure.
