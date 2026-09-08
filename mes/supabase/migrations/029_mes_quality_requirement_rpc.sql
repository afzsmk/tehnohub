-- Controlled maintenance of the task-level Quality Gate requirement.
-- Direct browser writes remain blocked by the MES operational write lockdown.

create or replace function mes_set_task_quality_required(
  p_task_id text,
  p_required boolean
)
returns production_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task production_tasks%rowtype;
  v_before jsonb;
  v_status text;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','MASTER']) then
    raise exception 'Недостаточно прав для настройки обязательного ОТК';
  end if;

  select * into v_task
    from production_tasks
   where id = p_task_id
   for update;
  if not found then raise exception 'Задание не найдено: %', p_task_id; end if;
  if v_task.status in ('COMPLETED','CANCELLED') then
    raise exception 'Нельзя менять требования ОТК для завершенного или отмененного задания';
  end if;

  v_before := jsonb_build_object('qualityRequired', coalesce(v_task.quality_required, false), 'qualityStatus', coalesce(v_task.quality_status, 'NOT_REQUIRED'), 'version', v_task.version);
  v_status := case when p_required then case when coalesce(v_task.quality_status, 'NOT_REQUIRED') = 'APPROVED' then 'APPROVED' else 'NOT_REQUIRED' end else 'NOT_REQUIRED' end;

  update production_tasks
     set quality_required = coalesce(p_required, false),
         quality_status = v_status,
         version = version + 1
   where id = p_task_id
   returning * into v_task;

  insert into audit_log(actor_id, entity_type, entity_id, action, before_state, after_state)
  values (
    auth.uid()::text,
    'PRODUCTION_TASK',
    p_task_id,
    'QUALITY_REQUIREMENT_CHANGED',
    v_before,
    jsonb_build_object('qualityRequired', v_task.quality_required, 'qualityStatus', v_task.quality_status, 'version', v_task.version)
  );

  return v_task;
end;
$$;

grant execute on function mes_set_task_quality_required(text,boolean) to authenticated;
