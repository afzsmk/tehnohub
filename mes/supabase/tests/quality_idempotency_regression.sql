select no_plan();

-- Quality decision retries must be idempotent while preserving the authoritative
-- full-quantity approval -> task completion -> order synchronization path.
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","app_metadata":{"mes_role":"ADMIN"}}',
  false
);

insert into operational_plans(id, version, horizon_start, horizon_end, status)
values ('QI-PLAN', 1, '2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z', 'DRAFT');
insert into products(id, code, name, unit)
values ('QI-PROD', 'QI-PROD', 'Quality Idempotency Product', 'шт');
insert into employees(id, personnel_no, name, profession, qualification_level, active)
values ('QI-EMP', 'QI-001', 'Quality Idempotency Operator', 'Оператор', 3, true);
insert into equipment(id, code, name, work_center, capabilities, active)
values ('QI-EQ', 'QI-EQ', 'Quality Idempotency Equipment', 'QI-WC', '["QI-OP"]'::jsonb, true);
insert into route_operations(
  id, product_id, sequence, code, name, work_center,
  required_qualification, required_equipment_ids,
  setup_minutes, run_minutes_per_unit, active
) values (
  'QI-OP', 'QI-PROD', 10, 'QI-OP', 'Quality Idempotency Operation', 'QI-WC',
  1, '["QI-EQ"]'::jsonb, 0, 1, true
);
insert into production_orders(id, external_id, number, plan_id, product_id, quantity, completed_quantity, due_at, priority, status)
values ('QI-ORDER', 'QI-EXT', 'QI-001', 'QI-PLAN', 'QI-PROD', 10, 0, '2026-01-10T00:00:00Z', 'NORMAL', 'IN_EXECUTION');
insert into production_tasks(
  id, order_id, operation_id, operation_sequence, status,
  planned_start, planned_end, planned_quantity, actual_quantity,
  version, quality_required, quality_status
) values (
  'QI-TASK', 'QI-ORDER', 'QI-OP', 10, 'RUNNING',
  '2026-01-02T08:00:00Z', '2026-01-02T10:00:00Z', 10, 10,
  2, true, 'PENDING'
);
insert into task_assignments(task_id, employee_id, equipment_id)
values ('QI-TASK', 'QI-EMP', 'QI-EQ');

select (mes_submit_quality_inspection(
  'QI-TASK', 'APPROVED', 10, 0, null, 'approved once', '2026-01-02T10:10:00Z', 'quality-key-1'
)).id;

select is((select status from production_tasks where id = 'QI-TASK'), 'COMPLETED', 'full approved inspection completes task');
select is((select quality_status from production_tasks where id = 'QI-TASK'), 'APPROVED', 'approved decision persists');
select is((select status from production_orders where id = 'QI-ORDER'), 'COMPLETED', 'task completion synchronizes order');
select is((select count(*) from quality_inspections where task_id = 'QI-TASK'), 1::bigint, 'first quality submission creates one inspection');
select is((select count(*) from production_events where task_id = 'QI-TASK'), 2::bigint, 'first quality completion creates result and completion events');

select (mes_submit_quality_inspection(
  'QI-TASK', 'APPROVED', 10, 0, null, 'approved once', '2026-01-02T10:10:00Z', 'quality-key-1'
)).id;

select is((select count(*) from quality_inspections where task_id = 'QI-TASK'), 1::bigint, 'quality retry does not duplicate inspection');
select is((select count(*) from production_events where task_id = 'QI-TASK'), 2::bigint, 'quality retry does not duplicate events');
select is((select status from production_tasks where id = 'QI-TASK'), 'COMPLETED', 'quality retry leaves completed task unchanged');
select is((select status from production_orders where id = 'QI-ORDER'), 'COMPLETED', 'quality retry leaves completed order unchanged');

select throws_ok(
  $$select mes_submit_quality_inspection('QI-TASK', 'APPROVED', 9, 0, null, 'conflicting retry', '2026-01-02T10:10:00Z', 'quality-key-1')$$,
  'Ключ идемпотентности уже используется для другого решения ОТК',
  'quality idempotency key cannot be reused with different inspected quantity'
);

select * from finish();
