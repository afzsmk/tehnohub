-- Authoritative MES runtime snapshot for authenticated clients.
-- The browser may cache the snapshot locally, but authenticated startup must
-- hydrate from PostgreSQL so persisted MES state remains the source of truth.

create or replace function mes_get_runtime_snapshot(p_plan_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan operational_plans%rowtype;
  v_role text := mes_current_role();
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if v_role = '' then raise exception 'MES role is not configured'; end if;

  select * into v_plan from operational_plans where id = p_plan_id limit 1;
  if v_plan.id is null then
    select * into v_plan from operational_plans order by created_at desc, id desc limit 1;
  end if;

  if v_plan.id is null then
    return jsonb_build_object('plan',null,'products','[]'::jsonb,'employees','[]'::jsonb,'equipment','[]'::jsonb,'shifts','[]'::jsonb,'calendar','[]'::jsonb,'employeeSchedules','[]'::jsonb,'equipmentBlocks','[]'::jsonb,'orders','[]'::jsonb,'tasks','[]'::jsonb,'downtimes','[]'::jsonb,'maintenance','[]'::jsonb,'results','[]'::jsonb,'qualityInspections','[]'::jsonb,'events','[]'::jsonb);
  end if;

  return jsonb_build_object(
    'plan', jsonb_build_object('id',v_plan.id,'version',v_plan.version,'horizonStart',v_plan.horizon_start,'horizonEnd',v_plan.horizon_end,'status',v_plan.status,'sourcePlanId',v_plan.source_plan_id,'sourcePlanVersion',v_plan.source_plan_version),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'unit',p.unit) order by p.id) from products p),'[]'::jsonb),
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'personnelNo',e.personnel_no,'name',e.name,'profession',e.profession,'qualificationLevel',e.qualification_level,'active',e.active) order by e.id) from employees e),'[]'::jsonb),
    'equipment', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'code',e.code,'name',e.name,'workCenter',e.work_center,'capabilities',e.capabilities,'active',e.active) order by e.id) from equipment e),'[]'::jsonb),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'startMinute',s.start_minute,'durationMinutes',s.duration_minutes) order by s.id) from shift_definitions s where s.active),'[]'::jsonb),
    'calendar', coalesce((select jsonb_agg(jsonb_build_object('date',cd.date::text,'isWorking',cd.is_working,'shiftIds',cd.shift_ids) order by cd.date) from calendar_days cd where cd.date >= v_plan.horizon_start::date and cd.date < v_plan.horizon_end::date),'[]'::jsonb),
    'employeeSchedules', coalesce((select jsonb_agg(jsonb_build_object('employeeId',es.employee_id,'date',es.date::text,'shiftIds',es.shift_ids,'status',es.status) order by es.employee_id,es.date) from employee_schedules es where es.date >= v_plan.horizon_start::date and es.date < v_plan.horizon_end::date),'[]'::jsonb),
    'equipmentBlocks', coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'equipmentId',b.equipment_id,'start',b.start_at,'end',b.end_at,'reason',b.reason,'comment',b.comment) order by b.start_at,b.id) from equipment_blocks b),'[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'externalId',o.external_id,'number',o.number,'productId',o.product_id,'quantity',o.quantity,'completedQuantity',o.completed_quantity,'dueAt',o.due_at,'priority',o.priority,'status',o.status,'route',coalesce((select jsonb_agg(jsonb_build_object('id',ro.id,'sequence',ro.sequence,'code',ro.code,'name',ro.name,'workCenter',ro.work_center,'requiredQualification',ro.required_qualification,'requiredEquipmentIds',ro.required_equipment_ids,'setupMinutes',ro.setup_minutes,'runMinutesPerUnit',ro.run_minutes_per_unit) order by ro.sequence) from route_operations ro where ro.product_id=o.product_id and ro.active),'[]'::jsonb)) order by o.due_at,o.priority desc,o.id) from production_orders o where o.plan_id=v_plan.id),'[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'orderId',t.order_id,'operationId',t.operation_id,'operationSequence',t.operation_sequence,'status',t.status,'plannedStart',t.planned_start,'plannedEnd',t.planned_end,'actualStart',t.actual_start,'actualEnd',t.actual_end,'plannedQuantity',t.planned_quantity,'actualQuantity',t.actual_quantity,'assignedEmployeeIds',coalesce((select jsonb_agg(a.employee_id order by a.employee_id) from task_assignments a where a.task_id=t.id and a.employee_id is not null),'[]'::jsonb),'assignedEquipmentIds',coalesce((select jsonb_agg(a.equipment_id order by a.equipment_id) from task_assignments a where a.task_id=t.id and a.equipment_id is not null),'[]'::jsonb),'qualityRequired',t.quality_required,'qualityStatus',t.quality_status,'version',t.version) order by t.planned_start,t.operation_sequence,t.id) from production_tasks t join production_orders o on o.id=t.order_id where o.plan_id=v_plan.id),'[]'::jsonb),
    'downtimes', coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'equipmentId',d.equipment_id,'reasonCode',d.reason_code,'startedAt',d.started_at,'endedAt',d.ended_at,'comment',d.comment) order by d.started_at,d.id) from downtime_events d),'[]'::jsonb),
    'maintenance', coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'equipmentId',m.equipment_id,'type',m.type,'plannedStart',m.planned_start,'plannedEnd',m.planned_end,'status',m.status,'comment',m.comment) order by m.planned_start,m.id) from maintenance_orders m),'[]'::jsonb),
    'results', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'taskId',r.task_id,'recordedAt',r.recorded_at,'goodQuantity',r.good_quantity,'scrapQuantity',r.scrap_quantity,'employeeIds',r.employee_ids,'equipmentIds',r.equipment_ids,'comment',r.comment) order by r.recorded_at,r.id) from production_results r join production_tasks t on t.id=r.task_id join production_orders o on o.id=t.order_id where o.plan_id=v_plan.id),'[]'::jsonb),
    'qualityInspections', coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'taskId',q.task_id,'inspectedAt',q.inspected_at,'inspectorId',q.inspector_id,'status',q.status,'goodQuantity',q.good_quantity,'scrapQuantity',q.scrap_quantity,'defectCode',q.defect_code,'comment',q.comment) order by q.inspected_at,q.id) from quality_inspections q join production_tasks t on t.id=q.task_id join production_orders o on o.id=t.order_id where o.plan_id=v_plan.id),'[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'taskId',e.task_id,'type',e.type,'occurredAt',e.occurred_at,'actorId',e.actor_id,'payload',e.payload) order by e.occurred_at,e.id) from production_events e where e.task_id is null or e.task_id in (select t.id from production_tasks t join production_orders o on o.id=t.order_id where o.plan_id=v_plan.id)),'[]'::jsonb)
  );
end;
$$;

revoke all on function mes_get_runtime_snapshot(text) from public;
grant execute on function mes_get_runtime_snapshot(text) to authenticated;

comment on function mes_get_runtime_snapshot(text) is
'Authoritative authenticated MES runtime snapshot. The requested plan is used when present; otherwise the latest operational plan is selected.';
