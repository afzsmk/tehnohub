-- Maintenance-generated blocks must remain bound to their maintenance lifecycle.
-- Generic equipment-block deletion cannot remove a maintenance-owned block.
-- Maintenance creation is serialized on the equipment and cannot cover an
-- active production task.

create or replace function mes_create_maintenance_order(
  p_equipment_id text,
  p_type text,
  p_planned_start timestamptz,
  p_planned_end timestamptz,
  p_comment text default null
)
returns maintenance_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order maintenance_orders%rowtype;
  v_block equipment_blocks%rowtype;
  v_id text;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if mes_current_role() not in ('MAINTENANCE','MASTER','DISPATCHER','ADMIN','PRODUCTION_MANAGER') then
    raise exception 'Недостаточно прав для создания заявки ППР/ремонта';
  end if;
  if p_type not in ('PM','REPAIR','INSPECTION') then
    raise exception 'Недопустимый тип обслуживания';
  end if;
  if p_planned_start is null or p_planned_end is null or p_planned_end <= p_planned_start then
    raise exception 'Интервал обслуживания некорректен';
  end if;
  if not exists (select 1 from equipment where id = p_equipment_id and active) then
    raise exception 'Оборудование не найдено или неактивно';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mes:equipment:' || p_equipment_id, 0));
  perform 1 from equipment where id = p_equipment_id for update;

  if exists (
    select 1
      from equipment_blocks b
     where b.equipment_id = p_equipment_id
       and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(p_planned_start, p_planned_end, '[)')
  ) then
    raise exception 'Оборудование уже заблокировано в указанном интервале';
  end if;

  if exists (
    select 1
      from production_tasks t
      join task_assignments a on a.task_id = t.id
     where a.equipment_id = p_equipment_id
       and t.status not in ('COMPLETED','CANCELLED')
       and tstzrange(t.planned_start, t.planned_end, '[)') && tstzrange(p_planned_start, p_planned_end, '[)')
  ) then
    raise exception 'Нельзя запланировать ППР поверх активного производственного задания; сначала выполните перепланирование';
  end if;

  v_id := concat('MO-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text));
  insert into maintenance_orders(id,equipment_id,type,planned_start,planned_end,status,comment)
  values (
    v_id,
    p_equipment_id,
    p_type,
    p_planned_start,
    p_planned_end,
    'PLANNED',
    nullif(trim(p_comment), '')
  )
  returning * into v_order;

  insert into equipment_blocks(id,equipment_id,start_at,end_at,reason,comment,maintenance_order_id)
  values (
    concat('EB-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_equipment_id,
    p_planned_start,
    p_planned_end,
    case p_type when 'PM' then 'MAINTENANCE' when 'REPAIR' then 'REPAIR' else 'OTHER' end,
    nullif(trim(p_comment), ''),
    v_order.id
  )
  returning * into v_block;

  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values (
    auth.uid()::text,
    'MES_MAINTENANCE_ORDER',
    v_order.id,
    'MAINTENANCE_CREATED',
    null,
    jsonb_build_object(
      'equipmentId', p_equipment_id,
      'type', p_type,
      'plannedStart', p_planned_start,
      'plannedEnd', p_planned_end,
      'blockId', v_block.id
    )
  );

  return v_order;
end;
$$;

grant execute on function mes_create_maintenance_order(text,text,timestamptz,timestamptz,text) to authenticated;

create or replace function mes_change_maintenance_status(
  p_order_id text,
  p_next_status text
)
returns maintenance_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order maintenance_orders%rowtype;
  v_before maintenance_orders%rowtype;
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if mes_current_role() not in ('MAINTENANCE','MASTER','DISPATCHER','ADMIN','PRODUCTION_MANAGER') then
    raise exception 'Недостаточно прав для изменения обслуживания';
  end if;
  if p_next_status not in ('PLANNED','IN_PROGRESS','DONE','CANCELLED') then
    raise exception 'Недопустимый статус обслуживания';
  end if;

  select * into v_order from maintenance_orders where id = p_order_id for update;
  if not found then raise exception 'Заявка обслуживания не найдена: %', p_order_id; end if;
  v_before := v_order;

  perform pg_advisory_xact_lock(hashtextextended('mes:equipment:' || v_order.equipment_id, 0));

  if v_order.status = 'DONE' then
    raise exception 'Завершённую заявку обслуживания нельзя изменить';
  end if;
  if v_order.status = p_next_status then return v_order; end if;
  if not (
    (v_order.status='PLANNED' and p_next_status in ('IN_PROGRESS','CANCELLED'))
    or (v_order.status='IN_PROGRESS' and p_next_status in ('DONE','CANCELLED'))
  ) then
    raise exception 'Недопустимый переход обслуживания % -> %', v_order.status, p_next_status;
  end if;

  update maintenance_orders
     set status = p_next_status
   where id = p_order_id
  returning * into v_order;

  if p_next_status = 'CANCELLED' then
    delete from equipment_blocks
     where maintenance_order_id = p_order_id
       and start_at >= v_now;
  elsif p_next_status = 'DONE' then
    -- Preserve the historical block interval; it remains harmless to scheduling
    -- once its planned end has passed and provides an auditable equipment history.
    null;
  elsif p_next_status = 'IN_PROGRESS' then
    null;
  end if;

  if p_next_status in ('IN_PROGRESS','DONE') then
    insert into production_events(id,type,occurred_at,actor_id,payload)
    values (
      concat('EV-',extract(epoch from clock_timestamp())::bigint,'-',md5(random()::text)),
      case when p_next_status='IN_PROGRESS' then 'MAINTENANCE_STARTED' else 'MAINTENANCE_COMPLETED' end,
      v_now,
      auth.uid()::text,
      jsonb_build_object(
        'maintenanceOrderId', p_order_id,
        'equipmentId', v_order.equipment_id,
        'statusBefore', v_before.status,
        'statusAfter', v_order.status,
        'role', mes_current_role()
      )
    );
  end if;

  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values (
    auth.uid()::text,
    'MES_MAINTENANCE_ORDER',
    p_order_id,
    'MAINTENANCE_STATUS_CHANGED',
    jsonb_build_object('status',v_before.status),
    jsonb_build_object('status',v_order.status)
  );

  return v_order;
end;
$$;

grant execute on function mes_change_maintenance_status(text,text) to authenticated;

create or replace function mes_delete_equipment_block(p_block_id text)
returns equipment_blocks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block equipment_blocks%rowtype;
  v_before jsonb;
  v_actor text := auth.uid()::text;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MAINTENANCE']) then
    raise exception 'Недостаточно прав для удаления блокировки оборудования';
  end if;
  if p_block_id is null or p_block_id = '' then
    raise exception 'Идентификатор блокировки обязателен';
  end if;

  select * into v_block
    from equipment_blocks
   where id = p_block_id
   for update;
  if not found then
    raise exception 'Блокировка не найдена: %', p_block_id;
  end if;

  if v_block.maintenance_order_id is not null then
    raise exception 'Блокировка создана заявкой обслуживания; изменяйте её через жизненный цикл ППР/ремонта';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mes:equipment:' || v_block.equipment_id, 0));
  v_before := to_jsonb(v_block);

  delete from equipment_blocks where id = p_block_id;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_actor, 'equipment_block', v_block.id, 'DELETE', v_before, null);

  return v_block;
end;
$$;

grant execute on function mes_delete_equipment_block(text) to authenticated;
