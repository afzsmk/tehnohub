-- MES Quality history hardening.
-- Quality inspections are operational evidence and therefore append-only.
-- Browser users may read the history according to MES role, but may not mutate it directly.

alter table quality_inspections enable row level security;

drop policy if exists mes_read_quality_inspections on quality_inspections;
create policy mes_read_quality_inspections
on quality_inspections
for select
to authenticated
using (mes_current_role() <> '');

drop policy if exists mes_no_direct_quality_insert on quality_inspections;
create policy mes_no_direct_quality_insert
on quality_inspections
for insert
to authenticated
with check (false);

drop policy if exists mes_no_direct_quality_update on quality_inspections;
create policy mes_no_direct_quality_update
on quality_inspections
for update
to authenticated
using (false)
with check (false);

drop policy if exists mes_no_direct_quality_delete on quality_inspections;
create policy mes_no_direct_quality_delete
on quality_inspections
for delete
to authenticated
using (false);

drop trigger if exists quality_inspections_append_only on quality_inspections;
create trigger quality_inspections_append_only
before update or delete on quality_inspections
for each row execute function prevent_append_only_mutation();

comment on table quality_inspections is 'MES quality-control decisions; append-only inspection history protected by RLS.';

grant select on quality_inspections to authenticated;
