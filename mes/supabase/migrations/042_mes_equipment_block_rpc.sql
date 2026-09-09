-- Equipment block lifecycle is controlled by SECURITY DEFINER RPCs.
-- Browser sessions keep read access but cannot bypass role, resource and
-- production-conflict validation with direct table writes.

drop policy if exists mes_manage_blocks on equipment_blocks;
create policy mes_no_direct_block_write on equipment_blocks
for all to authenticated using (false) with check (false);

comment on policy mes_no_direct_block_write on equipment_blocks is
'Direct browser mutation is forbidden; use MES equipment block RPCs.';

create or replace function mes_create_equipment_block(
  p_equipment_id text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason text,
  p_comment text default null
)
returns equipment_blocks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block equipment_blocks%rowtype;
  v_actor text := auth.uid()::text;
begin
  if auth.uid() is null then
    raise exception 'MES authentication required';
  end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','MAINTENANCE']) then
    raise exception 'Недостаточно прав для блокировки оборудования';
  end if;
  if p_equipment_id is null or p_equipment_id = '' then
    raise exception 'Оборудование обязательно';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'Интервал блокировки задан некорректно';
  end if;
  if p_reason not in ('MAINTENANCE','REPAIR','SETUP','OTHER') then
    raise exception 'Недопустимая причина блокировки: %', p_reason;
  end if;

  perform 1 from equipment where id = p_equipment_id for update;
  if not found then
    raise exception 'Оборудование не найдено: %', p_equipment_id;
  end if;
  if not exists (select 1 from equipment where id = p_equipment_id and active) then
    raise exception 'Нельзя блокировать неактивное оборудование: %', p_equipment_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mes:equipment:' || p_equipment_id, 0));

  if exists (
    select 1
      from equipment_blocks b
     where b.equipment_id = p_equipment_id
       and b.start_at < p_end_at
       and p_start_at < b.end_at
  ) then
    raise exception 'Для оборудования уже существует пересекающаяся блокировка';
  end if;

  if exists (
    select 1
      from production_tasks t
      join task_assignments a on a.task_id = t.id
     where a.equipment_id = p_equipment_id
       and t.status not in ('COMPLETED','CANCELLED')
       and t.planned_start < p_end_at
       and p_start_at < t.planned_end
  ) then
    raise exception 'Нельзя установить блокировку поверх активного производственного задания; сначала выполните перепланирование';
  end if;

  v_block.id := 'EB-' || md5(random()::text || clock_timestamp()::text || coalesce(v_actor, 'system'));
  v_block.equipment_id := p_equipment_id;
  v_block.start_at := p_start_at;
  v_block.end_at := p_end_at;
  v_block.reason := p_reason;
  v_block.comment := nullif(trim(p_comment), '');

  insert into equipment_blocks(id, equipment_id, start_at, end_at, reason, comment)
  values (v_block.id, v_block.equipment_id, v_block.start_at, v_block.end_at, v_block.reason, v_block.comment);

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_actor, 'equipment_block', v_block.id, 'CREATE', null, to_jsonb(v_block));

  return v_block;
end;
$$;

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

  perform pg_advisory_xact_lock(hashtextextended('mes:equipment:' || v_block.equipment_id, 0));
  v_before := to_jsonb(v_block);

  delete from equipment_blocks where id = p_block_id;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_actor, 'equipment_block', v_block.id, 'DELETE', v_before, null);

  return v_block;
end;
$$;

revoke all on function mes_create_equipment_block(text, timestamptz, timestamptz, text, text) from public;
revoke all on function mes_delete_equipment_block(text) from public;
grant execute on function mes_create_equipment_block(text, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function mes_delete_equipment_block(text) to authenticated;
