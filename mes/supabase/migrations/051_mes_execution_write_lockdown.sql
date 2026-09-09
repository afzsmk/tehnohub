-- Execution facts and quality decisions are authoritative MES state.
-- Browser sessions keep read access, but all writes must go through validated RPCs.

alter table if exists quality_inspections enable row level security;

drop policy if exists mes_read_quality_inspections on quality_inspections;
create policy mes_read_quality_inspections on quality_inspections
for select to authenticated using (mes_current_role() <> '');

drop policy if exists mes_manage_quality_inspections on quality_inspections;
drop policy if exists mes_write_quality_inspections on quality_inspections;
create policy mes_no_direct_quality_inspection_write on quality_inspections
for all to authenticated using (false) with check (false);

-- These entities already have controlled SECURITY DEFINER RPCs for all mutations.
drop policy if exists mes_write_downtime on downtime_events;
create policy mes_no_direct_downtime_write on downtime_events
for all to authenticated using (false) with check (false);

drop policy if exists mes_write_results on production_results;
create policy mes_no_direct_result_write on production_results
for all to authenticated using (false) with check (false);

drop policy if exists mes_write_events on production_events;
create policy mes_no_direct_event_write on production_events
for all to authenticated using (false) with check (false);

revoke insert, update, delete on quality_inspections from authenticated;
revoke insert, update, delete on downtime_events from authenticated;
revoke insert, update, delete on production_results from authenticated;
revoke insert, update, delete on production_events from authenticated;

-- Quality inspections are append-only history just like production results/events.
drop trigger if exists quality_inspections_append_only on quality_inspections;
create trigger quality_inspections_append_only
before update or delete on quality_inspections
for each row execute function prevent_append_only_mutation();

comment on policy mes_no_direct_quality_inspection_write on quality_inspections is
'Direct browser mutation is forbidden; use MES quality RPCs.';
comment on policy mes_no_direct_downtime_write on downtime_events is
'Direct browser mutation is forbidden; use MES downtime RPCs.';
comment on policy mes_no_direct_result_write on production_results is
'Direct browser mutation is forbidden; use mes_record_production_result RPC.';
comment on policy mes_no_direct_event_write on production_events is
'Direct browser mutation is forbidden; production events are emitted by MES RPCs.';
