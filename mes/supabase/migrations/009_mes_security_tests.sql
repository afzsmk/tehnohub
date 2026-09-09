-- Migration-time invariants for the MES security boundary.
-- These assertions fail loudly if a future migration accidentally removes the
-- user/employee binding table or the actor-bearing columns expected by RLS.

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from information_schema.tables
   where table_schema = 'public'
     and table_name = 'mes_user_employee';
  if v_count <> 1 then
    raise exception 'MES security invariant failed: mes_user_employee is missing';
  end if;

  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'downtime_events'
     and column_name = 'actor_user_id';
  if v_count <> 1 then
    raise exception 'MES security invariant failed: downtime_events.actor_user_id is missing';
  end if;

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public'
     and tablename = 'production_events'
     and policyname = 'mes_write_events';
  if v_count <> 1 then
    raise exception 'MES security invariant failed: production_events operator policy is missing';
  end if;

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public'
     and tablename = 'production_results'
     and policyname = 'mes_write_results';
  if v_count <> 1 then
    raise exception 'MES security invariant failed: production_results operator policy is missing';
  end if;
end $$;
