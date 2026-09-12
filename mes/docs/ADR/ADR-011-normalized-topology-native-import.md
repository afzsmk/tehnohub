# ADR-011 — Normalized topology as the native master-import path

## Status
Accepted

## Context
The MES bootstrap importer historically wrote equipment and route operations through legacy text-oriented RPCs and then populated normalized topology references with follow-up updates. That created a multi-step write path and allowed compatibility fields to become temporarily authoritative.

## Decision
For payloads carrying normalized topology references, bootstrap import shall use the controlled normalized RPCs directly:

- equipment → `mes_master_save_equipment_v2`, bound by `work_center_id`;
- route operation → `mes_master_save_route_operation_v2`, bound by `route_id`, `work_center_id`, and optional `required_qualification_id`.

Legacy RPCs remain available strictly as a compatibility path for older payloads that do not contain the normalized references.

The normalized RPC is authoritative for the corresponding relationship. Compatibility text/numeric fields are maintained by the server as derived compatibility data.

## Validation
Before import, normalized references must resolve to active entities. A route operation carrying `route_id` must reference the same `product_id` as the route header. Equipment and required equipment references must also resolve to active master data.

## Consequences
The import transaction has a single authoritative topology-aware write path, reducing post-write repair logic and making topology integrity explicit. Existing legacy payloads remain importable without forcing a breaking protocol change.
