select no_plan();

-- Regression coverage for the execution/equipment availability boundary.
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","app_metadata":{"mes_role":"ADMIN"}}',
  false
);

insert into operational_plans(id, version, horizon_start, horizon_end, status)
values ('EA-PLAN', 1, '2026-03-01T00:00:00Z', '2026-03-31T00:00:00Z', 'DRAFT');

insert into products(id, code, name, unit)
values ('EA-PRODUCT', 'EA-PROD', 'Equipment Availability Test Product', 'шт');

insert into employees(id, personnel_no, name, profession, qualification_level, active)
values ('EA-EMP', 'EA-001', 'Equipment Availability Operator', 'Оператор', 3, true);

insert into equipment(id, code, name, work_center, capabilities, active)
values ('EA-EQ', 'EA-EQ', 'Equipment Availability Test Equipment', 'EA-WC', '["EA-OP"]'::jsonb, true);

insert into route_operations(
  id, product_id, sequence, code, name, work_center,
  required_qualification, required_equipment_ids,
  setup_minutes, run_minutes_per_unit, active
) values (
  'EA-OP', 'EA-PRODUCT', 10, 'EA-OP', 'Equipment Availability Operation', 'EA-WC',
  1, '["EA-EQ"]'::jsonb, 0, 1, true
);

insert into production_orders(
  id, external_id, number, plan_id, product_id,
  quantity, completed_quantity, due_at, priority, status
) values (
  'EA-ORDER-BLOCK', 'EA-EXT-BLOCK', 'EA-001', 'EA-PLAN', 'EA-PRODUCT',
  10, 0, '2026-03-10T00:00:00Z', 'NORMAL', 'IN_EXECUTION'
), (
  'EA-ORDER-DOWNTIME', 'EA-EXT-DOWNTIME', 'EA-002', 'EA-PLAN', 'EA-PRODUCT',
  10, 0, '2026-03-11T00:00:00Z', 'NORMAL', 'IN_EXECUTION'
), (
  'EA-ORDER-MAINT', 'EA-EXT-MAINT', 'EA-003', 'EA-PLAN', 'EA-PRODUCT',
  10, 0, '2026-03-12T00:00:00Z', 'NORMAL', 'IN_EXECUTION'
);

insert into production_tasks(
  id, order_id, operation_id, operation_sequence, status,
  planned_start, planned_end, planned_quantity, actual_quantity,
  version, quality_required, quality_status
) values
  ('EA-TASK-BLOCK', 'EA-ORDER-BLOCK', 'EA-OP', 10, 'READY',
   '2026-03-02T08:00:00Z', '2026-03-02T10:00:00Z', 10, 0, 1, false, 'NOT_REQUIRED'),
  ('EA-TASK-DOWNTIME', 'EA-ORDER-DOWNTIME', 'EA-OP', 10, 'READY',
   '2026-03-03T08:00:00Z', '2026-03-03T10:00:00Z', 10, 0, 1, false, 'NOT_REQUIRED'),
  ('EA-TASK-MAINT', 'EA-ORDER-MAINT', 'EA-OP', 10, 'READY',
   '2026-03-04T08:00:00Z', '2026-03-04T10:00:00Z', 10, 0, 1, false, 'NOT_REQUIRED');

insert into task_assignments(task_id, employee_id, equipment_id)
values
  ('EA-TASK-BLOCK', 'EA-EMP', 'EA-EQ'),
  ('EA-TASK-DOWNTIME', 'EA-EMP', 'EA-EQ'),
  ('EA-TASK-MAINT', 'EA-EMP', 'EA-EQ');

-- An equipment block covering the actual START instant must stop execution even
-- when its interval no longer conflicts with the task's original planned window.
insert into equipment_blocks(id, equipment_id, start_at, end_at, reason, comment)
values ('EA-BLOCK', 'EA-EQ', '2026-03-02T07:00:00Z', '2026-03-02T09:00:00Z', 'REPAIR', 'runtime block');

select throws_ok(
  $$select mes_execute_task_action('EA-TASK-BLOCK', 'START', '2026-03-02T08:05:00Z')$$,
  'Нельзя запустить задание: оборудование EA-EQ заблокировано на момент запуска',
  'START rejects an equipment block active at the execution timestamp'
);
select is(
  (select status from production_tasks where id = 'EA-TASK-BLOCK'),
  'READY',
  'blocked equipment leaves task READY'
);

-- The exact block start belongs to the half-open [start_at,end_at) blocked interval.
select throws_ok(
  $$select mes_execute_task_action('EA-TASK-BLOCK', 'START', '2026-03-02T07:00:00Z')$$,
  'Нельзя запустить задание: оборудование EA-EQ заблокировано на момент запуска',
  'START rejects the exact equipment block start instant'
);

-- An open downtime is a runtime-unavailable condition and must prevent START.
insert into downtime_events(id, equipment_id, reason_code, started_at, ended_at, comment)
values ('EA-DT', 'EA-EQ', 'BREAKDOWN', '2026-03-03T07:30:00Z', null, 'open runtime downtime');

select throws_ok(
  $$select mes_execute_task_action('EA-TASK-DOWNTIME', 'START', '2026-03-03T08:05:00Z')$$,
  'Нельзя запустить задание: оборудование EA-EQ находится в простое на момент запуска',
  'START rejects open downtime at the execution timestamp'
);

-- Close the runtime downtime before exercising the independent maintenance
-- scenario and the later block-vs-downtime validation.
select mes_end_downtime('EA-DT', '2026-03-03T09:00:00Z');

-- IN_PROGRESS maintenance is a runtime-unavailable state even if the original
-- planned block interval has already elapsed (for example, a late repair).
insert into maintenance_orders(
  id, equipment_id, type, planned_start, planned_end, status, comment
) values (
  'EA-MAINT', 'EA-EQ', 'REPAIR',
  '2026-03-04T06:00:00Z', '2026-03-04T07:00:00Z', 'IN_PROGRESS', 'late repair'
);

select throws_ok(
  $$select mes_execute_task_action('EA-TASK-MAINT', 'START', '2026-03-04T08:05:00Z')$$,
  'Нельзя запустить задание: оборудование EA-EQ находится на обслуживании',
  'START rejects IN_PROGRESS maintenance at the execution boundary'
);

-- Downtime creation must use the equipment runtime boundary too: it cannot be
-- opened inside an already active equipment block.
select throws_ok(
  $$select mes_start_downtime('EA-EQ', 'BREAKDOWN', 'over block', '2026-03-02T08:10:00Z')$$,
  'Нельзя зарегистрировать простой: оборудование заблокировано на указанное время',
  'downtime cannot be started inside an equipment block'
);

-- A non-overlapping interval remains valid. Assert the persisted state separately
-- from the function call so SQL evaluation order cannot make the assertion flaky.
select lives_ok(
  $$select mes_start_downtime('EA-EQ', 'BREAKDOWN', 'valid downtime', '2026-03-05T08:00:00Z')$$,
  'downtime can be created outside a block'
);
select is(
  (select count(*) from downtime_events where equipment_id = 'EA-EQ' and comment = 'valid downtime'),
  1::bigint,
  'valid downtime is persisted once'
);

select * from finish();
