select no_plan();

-- A production-result submission is a single business operation across retries.
-- The second call with the same idempotency key must return the original append-only
-- fact even after the task/order have already reached their terminal state.
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555","app_metadata":{"mes_role":"ADMIN"}}',
  false
);

insert into operational_plans(id, version, horizon_start, horizon_end, status)
values ('ER-PLAN', 1, '2026-03-01T00:00:00Z', '2026-03-31T00:00:00Z', 'DRAFT');
insert into products(id, code, name, unit)
values ('ER-PROD', 'ER-PROD', 'Execution Idempotency Product', 'шт');
insert into employees(id, personnel_no, name, profession, qualification_level, active)
values ('ER-EMP', 'ER-001', 'Execution Idempotency Operator', 'Оператор', 3, true);
insert into equipment(id, code, name, work_center, capabilities, active)
values ('ER-EQ', 'ER-EQ', 'Execution Idempotency Equipment', 'ER-WC', '["ER-OP"]'::jsonb, true);
insert into route_operations(
  id, product_id, sequence, code, name, work_center,
  required_qualification, required_equipment_ids,
  setup_minutes, run_minutes_per_unit, active
) values (
  'ER-OP', 'ER-PROD', 10, 'ER-OP', 'Execution Idempotency Operation', 'ER-WC',
  1, '["ER-EQ"]'::jsonb, 0, 1, true
);
insert into production_orders(
  id, external_id, number, plan_id, product_id,
  quantity, completed_quantity, due_at, priority, status
) values (
  'ER-ORDER', 'ER-EXT', 'ER-001', 'ER-PLAN', 'ER-PROD',
  10, 0, '2026-03-10T00:00:00Z', 'NORMAL', 'IN_EXECUTION'
);
insert into production_tasks(
  id, order_id, operation_id, operation_sequence, status,
  planned_start, planned_end, actual_start, planned_quantity,
  actual_quantity, version, quality_required, quality_status
) values (
  'ER-TASK', 'ER-ORDER', 'ER-OP', 10, 'RUNNING',
  '2026-03-02T08:00:00Z', '2026-03-02T10:00:00Z', '2026-03-02T08:00:00Z',
  10, 0, 2, false, 'NOT_REQUIRED'
);
insert into task_assignments(task_id, employee_id, equipment_id)
values ('ER-TASK', 'ER-EMP', 'ER-EQ');

select (mes_record_production_result(
  'ER-TASK', 10, 0, '[]'::jsonb, 'complete once', '2026-03-02T09:00:00Z', 'result-key-1'
)).id;

select is((select actual_quantity from production_tasks where id = 'ER-TASK'), 10::numeric, 'first result updates task fact');
select is((select status from production_tasks where id = 'ER-TASK'), 'COMPLETED', 'first result completes non-quality task');
select is((select status from production_orders where id = 'ER-ORDER'), 'COMPLETED', 'first result synchronizes order completion');
select is((select count(*) from production_results where task_id = 'ER-TASK'), 1::bigint, 'first result creates one append-only fact');
select is((select count(*) from production_events where task_id = 'ER-TASK' and type = 'RESULT_RECORDED'), 1::bigint, 'first result creates one result event');

select (mes_record_production_result(
  'ER-TASK', 10, 0, '[]'::jsonb, 'complete once', '2026-03-02T09:00:00Z', 'result-key-1'
)).id;

select is((select count(*) from production_results where task_id = 'ER-TASK'), 1::bigint, 'replay does not duplicate production fact');
select is((select count(*) from production_events where task_id = 'ER-TASK' and type = 'RESULT_RECORDED'), 1::bigint, 'replay does not duplicate result event');
select is((select actual_quantity from production_tasks where id = 'ER-TASK'), 10::numeric, 'replay leaves task actual quantity unchanged');
select is((select version from production_tasks where id = 'ER-TASK'), 3, 'replay does not increment task version');

select throws_ok(
  $$select mes_record_production_result('ER-TASK', 9, 0, '[]'::jsonb, 'conflicting retry', '2026-03-02T09:00:00Z', 'result-key-1')$$,
  'Ключ идемпотентности уже используется для другого результата',
  'idempotency key cannot be reused with a different quantity'
);

select * from finish();
