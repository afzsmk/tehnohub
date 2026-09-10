# ADR-007: MES master-data administration and bootstrap import

- Status: Accepted
- Date: 2026-09-10

## Context

Production MES starts empty and requires controlled initial loading of real enterprise master data. Browser-side direct DML is forbidden for controlled MES state. The system also needs ongoing editing of operational master data after bootstrap.

## Decision

1. MES provides a dedicated Master Data area for supported current-schema entities: products, employees, equipment and shift definitions. Route operations remain in the dedicated route editor and calendar/schedule data remain in the calendar editor.
2. Master-data mutations are performed through audited SECURITY DEFINER RPCs with server-side role checks. Browser sessions do not receive direct write access to master tables.
3. Bootstrap data may be loaded from XLSX through Import Center. Excel is a bootstrap/user-interface format, not the Workforce integration protocol.
4. Import follows parse → server dry-run validation → explicit confirmation → one transactional server-side import. Validation errors block the import.
5. Each import is recorded in `mes_master_import_runs` and the import action is audited.
6. Operational history (tasks, production results, events, downtime events, quality inspections) is not created as fake bootstrap master data.
7. Current schema limitations are explicit: professions, qualification catalogs, brigades and route headers/versions are not yet first-class tables. Until schema normalization is implemented, the current supported fields remain authoritative.

## Consequences

- Initial commissioning can be performed from real plant data without bypassing MES business rules.
- Master data can be maintained after bootstrap through controlled UI actions.
- Imports are repeatable and auditable, with validation before mutation.
- Future normalization of professions/qualifications/brigades/routes will require a separate schema decision and migration.
