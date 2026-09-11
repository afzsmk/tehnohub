-- Backward-compatible bridge for legacy privileged/test inserts.
-- New MES code must provide the labor normalization fields explicitly.
create or replace function mes_route_operation_fill_labor_norm()
returns trigger
language plpgsql
as $$
begin
  if new.labor_norm_hours_per_unit is null then
    new.labor_norm_hours_per_unit := coalesce(new.run_minutes_per_unit, 0) / 60.0;
  end if;
  if new.setup_norm_hours is null then
    new.setup_norm_hours := coalesce(new.setup_minutes, 0) / 60.0;
  end if;
  if new.workers_required is null then
    new.workers_required := 1;
  end if;
  return new;
end;
$$;

drop trigger if exists mes_route_operation_fill_labor_norm_trg on route_operations;
create trigger mes_route_operation_fill_labor_norm_trg
before insert or update on route_operations
for each row
execute function mes_route_operation_fill_labor_norm();

comment on function mes_route_operation_fill_labor_norm() is
'Compatibility adapter for privileged legacy/test route writes. Browser MES writes use the labor-normalized RPC.';
