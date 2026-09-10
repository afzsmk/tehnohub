# ADR-006: MES uses labor-hour normalization (н-ч)

- Status: Accepted
- Date: 2026-09-10

## Context

Workforce calculations use labor norms in человеко-часах (н-ч). MES must not reinterpret these norms as simple elapsed machine minutes. MES still needs elapsed calendar intervals for dispatching and Gantt planning.

## Decision

1. `route_operations.labor_norm_hours_per_unit` is the primary variable labor norm in MES.
2. `route_operations.setup_norm_hours` is the setup/changeover labor norm per setup.
3. `route_operations.workers_required` defines concurrent workers for the operation.
4. For the current deterministic MVP, elapsed operation time is derived as:

   `elapsed_hours = (setup_norm_hours + labor_norm_hours_per_unit * quantity) / workers_required`

5. `planned_start` / `planned_end` remain elapsed calendar timestamps on `production_tasks`.
6. Existing `run_minutes_per_unit` and `setup_minutes` remain only for compatibility and migration; new planning code must not use them as authoritative norms.
7. A later enhancement may add machine-cycle/productivity parameters where equipment throughput differs materially from labor capacity. That enhancement must be explicit and must not silently replace the labor norm.

## Consequences

- Workforce and MES share a consistent unit of labor normalization.
- MES can calculate elapsed time for deterministic planning while preserving the original labor norm.
- Historical/planned tasks retain concrete calendar intervals independent of later route edits.
- Import templates and APIs should expose labor norms in н-ч, not minutes.
