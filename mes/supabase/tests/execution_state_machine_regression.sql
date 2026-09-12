select no_plan();

-- Regression coverage for the server-authoritative shop-floor execution boundary.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"mes_role":"ADMIN"}}',
  false
);

insert into operational_plans(id, version, horizon_start, horizon_end, status)
values ('SM-PLAN', 1, '2026-02-01T00:00:00Z', '2026-02-28T00:00:00Z', 'DRAFT');

insert into products(id, code, name, unit)
values ('SM-PRODUCT', 'SM-PROD', 'State Machine Test Product', 'шт');

insert into employees(id, personnel_no, name, profession, qualification_level, active)
values ('SM-EMP', 'SM-001', 'State Machine Operator', 'Оператор', 3, true);

insert into equipment(id, code, name, work_center, capabilities, active)
values ('SM-EQ', 'SM-EQ', 'State Machine Equipment', 'SM-WC', '["SM-OP"]'::jsonb, true);

insert into route_operations(
  id, product_id, sequence, code, name, work_center,
  required_qualification, required_equipment_ids,
  setup_minutes, run_minutes_per_unit, active
) values (
  'SM-OP', 'SM-PRODUCT', 10, 'SM-OP', 'State Machine Operation', 'SM-WC',
  1, '["SM-EQ"]'::jsonb, 0, 1, true
);

insert into production_orders(
  id, external_id, number, plan_id, product_id,
  quantity, completed_quantity, due_at, priority, status
) values (
  'SM-ORDER', 'SM-EXT', 'SM-001', 'SM-PLAN', 'SM-PRODUCT',
  10, 0, '2026-02-10T00:00:00Z', 'NORMAL', 'IN_EXECUTION'
);

insert into production_tasks(
  id, order_id, operation_id, operation_sequence, status,
  planned_start, planned_end, planned_quantity, actual_quantity,
  version, quality_required, quality_status
) values (
  'SM-TASK', 'SM-ORDER', 'SM-OP', 10, 'READY',
  '2026-02-02T08:00:00Z', '2026-02-02T10:00:00Z', 10, 0,
  1, false, 'NOT_REQUIRED'
);

insert into task_assignments(task_id, employee_id, equipment_id)
values ('SM-TASK', 'SM-EMP', 'SM-EQ');

select throws_ok(
  $$select mes_execute_task_action('SM-TASK', 'PAUSE', '2026-02-02T08:00:00Z')$$,
  'Недопустимый переход задания: READY -> PAUSED',
  'pause cannot bypass READY -> RUNNING'
);

select (mes_execute_task_action('SM-TASK', 'START', '2026-02-02T08:05:00Z')).id;
select is(
  (select status from production_tasks where id = 'SM-TASK'),
  'RUNNING',
  'READY transitions to RUNNING only through START'
);

select throws_ok(
  $$select mes_execute_task_action('SM-TASK', 'COMPLETE', '2026-02-02T09:00:00Z')$$,
  'Нельзя завершить задание: фактический выпуск меньше планового',
  'manual completion cannot bypass the production quantity gate'
);

select throws_ok(
  $$select mes_record_production_result('SM-TASK', 1, 0, '["NOT-ASSIGNED"]'::jsonb, null, '2026-02-02T08:30:00Z')$$,
  'Оборудование NOT-ASSIGNED не назначено на это задание',
  'production result cannot claim unassigned equipment'
);

select (mes_record_production_result(
  'SM-TASK', 10, 0, '["SM-EQ"]'::jsonb, 'complete task', '2026-02-02T09:30:00Z'
)).id;

select is(
  (select actual_quantity from production_tasks where id = 'SM-TASK'),
  10::numeric,
  'production result accumulates actual good quantity'
);
select is(
  (select status from production_tasks where id = 'SM-TASK'),
  'COMPLETED',
  'result reaching plan completes a non-quality-gated task'
);
select ok(
  (select count(*) from production_events where task_id = 'SM-TASK' and type = 'RESULT_RECORDED') = 1,
  'exactly one result event is emitted for the accepted fact'
);

select throws_ok(
  $$select mes_record_production_result('SM-TASK', 1, 0, '["SM-EQ"]'::jsonb, null, '2026-02-02T09:40:00Z')$$,
  'Задание уже завершено или отменено',
  'completed task cannot accept another production fact'
);

select * from finish();
