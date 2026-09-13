-- Close the concurrent idempotency replay race at the execution boundary.
--
-- The existing production-result and quality-inspection implementations first
-- check the idempotency key and only then acquire the operational-plan/task lock.
-- A concurrent retry can therefore miss the first uncommitted row, wait for the
-- lock, observe a terminal task state, and incorrectly fail instead of replaying
-- the committed fact. Keep the proven implementations intact as private helpers
-- and add a lock-aware public wrapper that rechecks the key after serialization.

alter function mes_record_production_result(
  text, numeric, numeric, jsonb, text, timestamptz, text
) rename to mes_record_production_result_impl_v104;

create or replace function mes_record_production_result(
  p_task_id text,
  p_good_quantity numeric,
  p_scrap_quantity numeric,
  p_equipment_ids jsonb default '[]'::jsonb,
  p_comment text default null,
  p_recorded_at timestamptz default now(),
  p_idempotency_key text default null
)
returns production_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id text;
  v_existing production_results%rowtype;
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;

  -- Fast replay remains the cheapest path for ordinary sequential retries.
  if v_key is not null then
    select * into v_existing
      from production_results
     where idempotency_key = v_key;
    if found then
      if v_existing.task_id <> p_task_id
         or v_existing.good_quantity <> p_good_quantity
         or v_existing.scrap_quantity <> p_scrap_quantity then
        raise exception 'Ключ идемпотентности уже используется для другого результата';
      end if;
      return v_existing;
    end if;
  end if;

  -- Serialize against the same operational-plan mutations as the underlying
  -- implementation. The critical part is the second idempotency lookup below:
  -- it runs after a concurrent writer had a chance to commit while we waited.
  select o.plan_id
    into v_plan_id
    from production_tasks t
    join production_orders o on o.id = t.order_id
   where t.id = p_task_id;
  if v_plan_id is null then
    raise exception 'Операционный план задания не найден: %', p_task_id;
  end if;

  perform 1
    from operational_plans
   where id = v_plan_id
   for update;
  if not found then
    raise exception 'Операционный план не найден: %', v_plan_id;
  end if;

  if v_key is not null then
    select * into v_existing
      from production_results
     where idempotency_key = v_key;
    if found then
      if v_existing.task_id <> p_task_id
         or v_existing.good_quantity <> p_good_quantity
         or v_existing.scrap_quantity <> p_scrap_quantity then
        raise exception 'Ключ идемпотентности уже используется для другого результата';
      end if;
      return v_existing;
    end if;
  end if;

  return mes_record_production_result_impl_v104(
    p_task_id,
    p_good_quantity,
    p_scrap_quantity,
    p_equipment_ids,
    p_comment,
    p_recorded_at,
    p_idempotency_key
  );
end;
$$;

revoke execute on function mes_record_production_result_impl_v104(text,numeric,numeric,jsonb,text,timestamptz,text) from public;
revoke execute on function mes_record_production_result_impl_v104(text,numeric,numeric,jsonb,text,timestamptz,text) from anon;
revoke execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz,text) from public;
revoke execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz,text) from anon;
grant execute on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz,text) to authenticated;

alter function mes_submit_quality_inspection(
  text, text, numeric, numeric, text, text, timestamptz, text
) rename to mes_submit_quality_inspection_impl_v102;

create or replace function mes_submit_quality_inspection(
  p_task_id text,
  p_status text,
  p_good_quantity numeric default 0,
  p_scrap_quantity numeric default 0,
  p_defect_code text default null,
  p_comment text default null,
  p_inspected_at timestamptz default now(),
  p_idempotency_key text default null
)
returns quality_inspections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id text;
  v_existing quality_inspections%rowtype;
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;

  -- Fast replay for the common non-concurrent retry path.
  if v_key is not null then
    select * into v_existing
      from quality_inspections
     where idempotency_key = v_key;
    if found then
      if v_existing.task_id <> p_task_id
         or v_existing.status <> p_status
         or v_existing.good_quantity <> p_good_quantity
         or v_existing.scrap_quantity <> p_scrap_quantity
         or coalesce(v_existing.defect_code, '') <> coalesce(nullif(trim(p_defect_code), ''), '') then
        raise exception 'Ключ идемпотентности уже используется для другого решения ОТК';
      end if;
      return v_existing;
    end if;
  end if;

  -- Keep Quality Gate on the same operational-plan -> task lock order.
  select o.plan_id
    into v_plan_id
    from production_tasks t
    join production_orders o on o.id = t.order_id
   where t.id = p_task_id;
  if v_plan_id is null then
    raise exception 'Операционный план задания не найден: %', p_task_id;
  end if;

  perform 1
    from operational_plans
   where id = v_plan_id
   for update;
  if not found then
    raise exception 'Операционный план не найден: %', v_plan_id;
  end if;

  -- Critical post-lock recheck: a concurrent successful submission may now be
  -- committed even though the first lookup observed no row.
  if v_key is not null then
    select * into v_existing
      from quality_inspections
     where idempotency_key = v_key;
    if found then
      if v_existing.task_id <> p_task_id
         or v_existing.status <> p_status
         or v_existing.good_quantity <> p_good_quantity
         or v_existing.scrap_quantity <> p_scrap_quantity
         or coalesce(v_existing.defect_code, '') <> coalesce(nullif(trim(p_defect_code), ''), '') then
        raise exception 'Ключ идемпотентности уже используется для другого решения ОТК';
      end if;
      return v_existing;
    end if;
  end if;

  return mes_submit_quality_inspection_impl_v102(
    p_task_id,
    p_status,
    p_good_quantity,
    p_scrap_quantity,
    p_defect_code,
    p_comment,
    p_inspected_at,
    p_idempotency_key
  );
end;
$$;

revoke execute on function mes_submit_quality_inspection_impl_v102(text,text,numeric,numeric,text,text,timestamptz,text) from public;
revoke execute on function mes_submit_quality_inspection_impl_v102(text,text,numeric,numeric,text,text,timestamptz,text) from anon;
revoke execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz,text) from public;
revoke execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz,text) from anon;
grant execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz,text) to authenticated;

comment on function mes_record_production_result(text,numeric,numeric,jsonb,text,timestamptz,text) is
'Authoritative idempotent production-result boundary; rechecks the idempotency key after execution serialization to guarantee concurrent replay safety.';

comment on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz,text) is
'Authoritative idempotent quality decision boundary; rechecks the idempotency key after execution serialization to guarantee concurrent replay safety.';
