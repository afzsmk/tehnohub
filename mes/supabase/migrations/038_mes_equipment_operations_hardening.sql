-- MES equipment operations: server-authoritative maintenance and downtime.
-- Maintenance creates a linked equipment block; cancellation releases only its own future block.

alter table equipment_blocks
  add column if not exists maintenance_order_id text references maintenance_orders(id);

create index if not exists idx_equipment_blocks_maintenance
  on equipment_blocks(maintenance_order_id);

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
  if p_type not in ('PM','REPAIR','INSPECTION') then raise exception 'Недопустимый тип обслуживания'; end if;
  if p_planned_end <= p_planned_start then raise exception 'Интервал обслуживания некорректен'; end if;
  if not exists (select 1 from equipment where id = p_equipment_id and active) then
    raise exception 'Оборудование не найдено или неактивно';
  end if;
  if exists (
    select 1 from equipment_blocks b
     where b.equipment_id = p_equipment_id
       and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(p_planned_start,p_planned_end,'[)')
  ) then
    raise exception 'Оборудование уже заблокировано в указанном интервале';
  end if;

  v_id := concat('MO-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text));
  insert into maintenance_orders(id,equipment_id,type,planned_start,planned_end,status,comment)
  values (v_id,p_equipment_id,p_type,p_planned_start,p_planned_end,'PLANNED',nullif(p_comment,''))
  returning * into v_order;

  insert into equipment_blocks(id,equipment_id,start_at,end_at,reason,comment,maintenance_order_id)
  values (
    concat('EB-', extract(epoch from clock_timestamp())::bigint, '-', md5(random()::text)),
    p_equipment_id,p_planned_start,p_planned_end,
    case p_type when 'PM' then 'MAINTENANCE' when 'REPAIR' then 'REPAIR' else 'OTHER' end,
    nullif(p_comment,''),v_order.id
  ) returning * into v_block;

  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values (
    auth.uid()::text,'MES_MAINTENANCE_ORDER',v_order.id,'MAINTENANCE_CREATED',null,
    jsonb_build_object('equipmentId',p_equipment_id,'type',p_type,'plannedStart',p_planned_start,'plannedEnd',p_planned_end,'blockId',v_block.id)
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
  if not found then raise exception 'Заявка обслуживания не найдена: %',p_order_id; end if;
  v_before := v_order;
  if v_order.status = 'DONE' then raise exception 'Завершённую заявку обслуживания нельзя изменить'; end if;
  if v_order.status = p_next_status then return v_order; end if;
  if not (
    (v_order.status='PLANNED' and p_next_status in ('IN_PROGRESS','CANCELLED'))
    or (v_order.status='IN_PROGRESS' and p_next_status in ('DONE','CANCELLED'))
  ) then raise exception 'Недопустимый переход обслуживания % -> %',v_order.status,p_next_status; end if;

  if p_next_status = 'IN_PROGRESS' and v_order.planned_end <= v_now then
    -- Allow late starts, but the historical block remains tied to the original planned interval.
    null;
  end if;

  update maintenance_orders set status=p_next_status where id=p_order_id returning * into v_order;

  if p_next_status = 'CANCELLED' then
    delete from equipment_blocks where maintenance_order_id = p_order_id and start_at >= v_now;
  end if;

  insert into production_events(id,type,occurred_at,actor_id,payload)
  values (
    concat('EV-',extract(epoch from clock_timestamp())::bigint,'-',md5(random()::text)),
    case when p_next_status='IN_PROGRESS' then 'MAINTENANCE_STARTED' when p_next_status='DONE' then 'MAINTENANCE_COMPLETED' else 'MAINTENANCE_STARTED' end,
    v_now,auth.uid()::text,
    jsonb_build_object('maintenanceOrderId',p_order_id,'equipmentId',v_order.equipment_id,'statusBefore',v_before.status,'statusAfter',v_order.status,'role',mes_current_role())
  );

  insert into audit_log(actor_id,entity_type,entity_id,action,before_state,after_state)
  values (
    auth.uid()::text,'MES_MAINTENANCE_ORDER',p_order_id,'MAINTENANCE_STATUS_CHANGED',
    jsonb_build_object('status',v_before.status),jsonb_build_object('status',v_order.status)
  );
  return v_order;
end;
$$;

grant execute on function mes_change_maintenance_status(text,text) to authenticated;

create or replace function mes_start_downtime(
  p_equipment_id text,
  p_reason_code text,
  p_comment text default null,
  p_started_at timestamptz default now()
)
returns downtime_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event downtime_events%rowtype;
  v_employee_id text;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if mes_current_role() not in ('OPERATOR','MASTER','MAINTENANCE','DISPATCHER','ADMIN','PRODUCTION_MANAGER') then
    raise exception 'Недостаточно прав для регистрации простоя';
  end if;
  if p_reason_code is null or nullif(trim(p_reason_code),'') is null then raise exception 'Укажите причину простоя'; end if;
  if p_started_at > now() + interval '5 minutes' then raise exception 'Время начала простоя не может быть в будущем'; end if;
  if not exists (select 1 from equipment e where e.id=p_equipment_id and e.active) then raise exception 'Оборудование не найдено или неактивно'; end if;
  if exists (select 1 from downtime_events where equipment_id=p_equipment_id and ended_at is null) then raise exception 'Для оборудования уже зарегистрирован открытый простой'; end if;

  v_employee_id := mes_current_employee_id();
  insert into downtime_events(id,equipment_id,reason_code,started_at,comment)
  values (
    concat('DT-',extract(epoch from clock_timestamp())::bigint,'-',md5(random()::text)),
    p_equipment_id,p_reason_code,p_started_at,nullif(p_comment,'')
  ) returning * into v_event;

  insert into production_events(id,type,occurred_at,actor_id,payload)
  values (
    concat('EV-',extract(epoch from clock_timestamp())::bigint,'-',md5(random()::text)),
    'DOWNTIME_STARTED',p_started_at,auth.uid()::text,
    jsonb_build_object('downtimeId',v_event.id,'equipmentId',p_equipment_id,'reasonCode',p_reason_code,'employeeId',v_employee_id,'role',mes_current_role())
  );
  return v_event;
end;
$$;

grant execute on function mes_start_downtime(text,text,text,timestamptz) to authenticated;

create or replace function mes_end_downtime(
  p_downtime_id text,
  p_ended_at timestamptz default now()
)
returns downtime_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event downtime_events%rowtype;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if mes_current_role() not in ('OPERATOR','MASTER','MAINTENANCE','DISPATCHER','ADMIN','PRODUCTION_MANAGER') then
    raise exception 'Недостаточно прав для завершения простоя';
  end if;
  select * into v_event from downtime_events where id=p_downtime_id for update;
  if not found then raise exception 'Простой не найден: %',p_downtime_id; end if;
  if v_event.ended_at is not null then raise exception 'Простой уже закрыт'; end if;
  if p_ended_at < v_event.started_at then raise exception 'Время окончания простоя раньше начала'; end if;

  update downtime_events set ended_at=p_ended_at where id=p_downtime_id returning * into v_event;
  insert into production_events(id,type,occurred_at,actor_id,payload)
  values (
    concat('EV-',extract(epoch from clock_timestamp())::bigint,'-',md5(random()::text)),
    'DOWNTIME_ENDED',p_ended_at,auth.uid()::text,
    jsonb_build_object('downtimeId',v_event.id,'equipmentId',v_event.equipment_id,'role',mes_current_role())
  );
  return v_event;
end;
$$;

grant execute on function mes_end_downtime(text,timestamptz) to authenticated;
