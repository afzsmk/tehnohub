-- MES resource recommendation: soft employee calendar filter
create or replace function public.mes_recommend_task_resources(p_task_id text)
returns table(resource_type text, resource_id text, resource_name text, score numeric, reasons jsonb)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_task production_tasks%rowtype;
  v_product_id text;
  v_work_center text;
  v_work_center_id text;
  v_operation_code text;
  v_required_qualification integer;
  v_required_qualification_id text;
  v_required_equipment_ids jsonb;
  v_has_equipment_scope boolean;
  v_work_range tstzrange;
  v_workers_required integer := 1;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then
    raise exception 'Недостаточно прав для подбора ресурсов';
  end if;

  select * into v_task from production_tasks where id=p_task_id;
  if not found then raise exception 'Задание не найдено: %',p_task_id; end if;
  if v_task.status in('COMPLETED','CANCELLED') then
    raise exception 'Для завершённого или отменённого задания подбор ресурсов недоступен';
  end if;

  select o.product_id into v_product_id from production_orders o where o.id=v_task.order_id;
  select r.work_center,r.work_center_id,r.code,r.required_qualification,r.required_qualification_id,
         r.required_equipment_ids,coalesce(r.workers_required,1)
    into v_work_center,v_work_center_id,v_operation_code,v_required_qualification,
         v_required_qualification_id,v_required_equipment_ids,v_workers_required
    from route_operations r
   where r.id=v_task.operation_id and r.product_id=v_product_id and r.active;
  if not found then raise exception 'Активная операция маршрута не найдена'; end if;

  select exists(
    select 1 from qualification_equipment_access qea
     where qea.qualification_id=v_required_qualification_id
       and (qea.valid_from is null or qea.valid_from<=current_date)
       and (qea.valid_to is null or qea.valid_to>=current_date)
  ) into v_has_equipment_scope;
  v_work_range:=tstzrange(v_task.planned_start,v_task.planned_end,'[)');

  return query
  with employee_candidates as (
    select
      e.id,
      e.name,
      (
        100
        + greatest(0,e.qualification_level-coalesce(v_required_qualification,0))*10
        - (
          select count(*)*10
          from task_assignments a
          join production_tasks t on t.id=a.task_id
          where a.employee_id=e.id and t.id<>v_task.id
            and t.status in('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
            and tstzrange(t.planned_start,t.planned_end,'[)')&&v_work_range
        )
        + case when exists(
            select 1
            from employee_schedules es
            where es.employee_id=e.id
              and es.status='WORK'
              and es.date between (v_task.planned_start at time zone 'UTC')::date
                              and ((v_task.planned_end-interval '1 microsecond') at time zone 'UTC')::date
          ) then 10 else 0 end
      )::numeric candidate_score,
      jsonb_build_array(
        case
          when v_required_qualification_id is not null then 'Точная квалификация проверяется при назначении'
          else format('Квалификация: %s',e.qualification_level)
        end,
        format('Требуется работников: %s',v_workers_required),
        'Сотрудник активен',
        'Нет пересечения по текущим заданиям',
        case when exists(
          select 1 from employee_schedules es
          where es.employee_id=e.id and es.status='WORK'
            and es.date between (v_task.planned_start at time zone 'UTC')::date
                            and ((v_task.planned_end-interval '1 microsecond') at time zone 'UTC')::date
        )
        then 'Есть рабочие смены в интервале'
        else 'Нет полного календарного покрытия; при длинной операции потребуется распределение по сменам'
        end
      ) candidate_reasons
    from employees e
    where e.active
      and (
        (
          v_required_qualification_id is not null and
          (
            exists(
              select 1 from employee_qualifications eq
              where eq.employee_id=e.id and eq.qualification_id=v_required_qualification_id
                and (eq.valid_from is null or eq.valid_from<=current_date)
                and (eq.valid_to is null or eq.valid_to>=current_date)
            )
            or e.qualification_id=v_required_qualification_id
          )
        )
        or (
          v_required_qualification_id is null and
          (v_required_qualification is null or e.qualification_level>=v_required_qualification)
        )
      )
      and not exists(
        select 1
        from task_assignments a
        join production_tasks t on t.id=a.task_id
        where a.employee_id=e.id and t.id<>v_task.id
          and t.status in('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
          and tstzrange(t.planned_start,t.planned_end,'[)')&&v_work_range
      )
  )
  select 'EMPLOYEE',ec.id,ec.name,ec.candidate_score,ec.candidate_reasons
  from employee_candidates ec
  order by ec.candidate_score desc,ec.name
  limit 20;

  return query
  with equipment_candidates as (
    select
      e.id,
      e.name,
      (
        100
        - (
          select count(*)*20
          from task_assignments a
          join production_tasks t on t.id=a.task_id
          where a.equipment_id=e.id and t.id<>v_task.id
            and t.status in('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
            and tstzrange(t.planned_start,t.planned_end,'[)')&&v_work_range
        )
      )::numeric candidate_score,
      jsonb_build_array(
        format('Рабочий центр: %s',coalesce(e.work_center_id,e.work_center)),
        case when v_has_equipment_scope then 'Допуск квалификации подтверждён'
             when jsonb_array_length(coalesce(v_required_equipment_ids,'[]'::jsonb))>0 then 'Разрешено операцией маршрута'
             else 'Допустимо оборудованием рабочего центра' end,
        'Оборудование активно',
        'Нет пересечения по заданиям',
        'Нет блока или обслуживания на интервале'
      ) candidate_reasons
    from equipment e
    where e.active
      and (
        (nullif(trim(v_work_center_id),'') is not null and e.work_center_id=v_work_center_id)
        or (nullif(trim(v_work_center_id),'') is null and e.work_center=trim(v_work_center))
      )
      and (
        jsonb_array_length(coalesce(v_required_equipment_ids,'[]'::jsonb))=0
        or e.id in(select jsonb_array_elements_text(v_required_equipment_ids))
      )
      and (
        not v_has_equipment_scope
        or e.id in(
          select qea.equipment_id
          from qualification_equipment_access qea
          where qea.qualification_id=v_required_qualification_id
            and (qea.valid_from is null or qea.valid_from<=current_date)
            and (qea.valid_to is null or qea.valid_to>=current_date)
        )
      )
      and not exists(
        select 1 from task_assignments a
        join production_tasks t on t.id=a.task_id
        where a.equipment_id=e.id and t.id<>v_task.id
          and t.status in('ASSIGNED','READY','RUNNING','PAUSED','PARTIALLY_COMPLETED')
          and tstzrange(t.planned_start,t.planned_end,'[)')&&v_work_range
      )
      and not exists(
        select 1 from equipment_blocks b
        where b.equipment_id=e.id
          and tstzrange(b.start_at,b.end_at,'[)')&&v_work_range
      )
      and not exists(
        select 1 from maintenance_orders m
        where m.equipment_id=e.id
          and m.status in('PLANNED','IN_PROGRESS')
          and tstzrange(m.planned_start,m.planned_end,'[)')&&v_work_range
      )
  )
  select 'EQUIPMENT',ec.id,ec.name,ec.candidate_score,ec.candidate_reasons
  from equipment_candidates ec
  order by ec.candidate_score desc,ec.name
  limit 20;
end;
$function$;
