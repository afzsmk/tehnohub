-- MES Quality: inspection history is immutable.
-- Corrections are represented by a new inspection decision, never by UPDATE/DELETE.

drop trigger if exists quality_inspections_append_only on quality_inspections;
create trigger quality_inspections_append_only
before update or delete on quality_inspections
for each row execute function prevent_append_only_mutation();

comment on trigger quality_inspections_append_only on quality_inspections is
  'Quality inspection history is append-only; corrections require a new inspection record.';
