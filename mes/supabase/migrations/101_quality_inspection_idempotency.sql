-- Transactional idempotency for Quality Gate decisions.
-- A repeated submit after a network timeout must return the original inspection
-- and must not mutate the task or append another event.

alter table quality_inspections
  add column if not exists idempotency_key text;

create unique index if not exists uq_quality_inspections_idempotency_key
  on quality_inspections(idempotency_key)
  where idempotency_key is not null;

drop function if exists mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz);

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
  v_task production_tasks%rowtype;
  v_inspection quality_inspections%rowtype;
  v_existing quality_inspections%rowtype;
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if mes_current_role() not in ('QUALITY','ADMIN','PRODUCTION_MANAGER') then
    raise exception 'Только ОТК может вынести решение по качеству';
  end if;
  if p_status not in ('APPROVED','REJECTED') then raise exception 'Недопустимый статус ОТК'; end if;
  if p_good_quantity < 0 or p_scrap_quantity < 0 or p_good_quantity + p_scrap_quantity <= 0 then
    raise exception 'Некорректное количество результата ОТК';
  end if;
  if v_key is not null and length(v_key) > 200 then
    raise exception 'Ключ идемпотентности слишком длинный';
  end if;

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

  select * into v_task from production_tasks where id = p_task_id for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if not v_task.quality_required then raise exception 'Для задания ОТК не требуется'; end if;
  if v_task.quality_status <> 'PENDING' then raise exception 'Задание не ожидает решения ОТК'; end if;

  if p_status = 'APPROVED' and p_scrap_quantity > 0 then
    raise exception 'При APPROVED количество брака должно быть 0';
  end if;
  if p_status = 'REJECTED' and coalesce(nullif(trim(p_defect_code), ''), '') = '' then
    raise exception 'Для отклонения ОТК требуется код дефекта';
  end if;

  insert into quality_inspections(
    id, task_id, inspected_at, inspector_id, status,
    good_quantity, scrap_quantity, defect_code, comment, idempotency_key
  ) values (
    concat('QI-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id, p_inspected_at, auth.uid()::text, p_status,
    p_good_quantity, p_scrap_quantity, nullif(trim(p_defect_code), ''), nullif(p_comment, ''), v_key
  )
  on conflict (idempotency_key) do nothing
  returning * into v_inspection;

  if v_inspection.id is null then
    select * into v_existing from quality_inspections where idempotency_key = v_key;
    if not found then raise exception 'MES: идемпотентное решение ОТК не найдено после конфликтной вставки'; end if;
    if v_existing.task_id <> p_task_id
       or v_existing.status <> p_status
       or v_existing.good_quantity <> p_good_quantity
       or v_existing.scrap_quantity <> p_scrap_quantity
       or coalesce(v_existing.defect_code, '') <> coalesce(nullif(trim(p_defect_code), ''), '') then
      raise exception 'Ключ идемпотентности уже используется для другого решения ОТК';
    end if;
    return v_existing;
  end if;

  update production_tasks
     set quality_status = p_status,
         version = version + 1
   where id = p_task_id;

  insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
  values (
    concat('EV-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_task_id,
    'RESULT_RECORDED',
    p_inspected_at,
    auth.uid()::text,
    jsonb_build_object(
      'qualityInspectionId', v_inspection.id,
      'qualityStatus', p_status,
      'defectCode', v_inspection.defect_code,
      'goodQuantity', p_good_quantity,
      'scrapQuantity', p_scrap_quantity,
      'idempotencyKey', v_key,
      'role', mes_current_role()
    )
  );

  return v_inspection;
end;
$$;

revoke execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz) from public;
revoke execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz) from anon;
revoke execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz,text) from public;
revoke execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz,text) from anon;
grant execute on function mes_submit_quality_inspection(text,text,numeric,numeric,text,text,timestamptz,text) to authenticated;
