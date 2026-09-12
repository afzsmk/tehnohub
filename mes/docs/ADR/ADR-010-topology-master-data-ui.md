# ADR-010 — Topology master-data UI

## Status
Accepted

MES provides a dedicated UI for work centers, route headers/versions, and equipment capabilities. It complements the general master-data page and route operation editor.

The UI performs no direct database writes. It reads master data and invokes authenticated MES RPCs for mutations.
