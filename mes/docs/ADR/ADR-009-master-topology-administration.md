# ADR-009 — Master topology administration

## Status
Accepted

## Decision
MES shall expose dedicated administration for normalized work centers, route headers/versions, and equipment capabilities. These entities are part of the authoritative MES master-data layer and are also accepted by the controlled bootstrap import contract.

Route operations remain the detailed technological definition and continue to be edited separately. Workforce remains the owner of labor norms at planning/integration level; MES consumes the normalized labor values for operational scheduling.

## Rationale
Keeping work centers and route headers as first-class entities prevents the bootstrap workbook from losing topology information and gives the operator a durable place to maintain it after initial import.
