select no_plan();

-- Deterministic end-to-end MES lifecycle executed against the real local schema.
-- The test uses an ADMIN JWT context so controlled SECURITY DEFINER RPCs execute
-- through the same auth/role resolution used by browser clients.

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"mes_role":"ADMIN"}}',
  true
);

insert into operational_plans(id, version, horizon_start, horizon_end, status)
values ('E2E-PLAN', 1, '2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z', 'DRAFT');

insert into products(id, code, name, unit)
values ('E2E-PRODUCT', 'E2E', 'E2E MES Test Product', 'шт');

insert into route_operations(
  id, product_id, sequence, code, name, work_center,
  required_qualification, required_equipment_ids,
  setup_minutes, run_minutes_per_unit, active
) values (
  'E2E-OP-10', 'E2E-PRODUCT', 10, 'E2E-OP', 'E2E Operation', 'E2E WC',
  1, '[]'::jsonb, 0, 1, true
);

insert into production_orders(
  id, external_id, number, plan_id, product_id,
  quantity, completed_quantity, due_at, priority, status
) values (
  'E2E-ORDER', 'E2E-EXT', 'E2E-001', 'E2E-PLAN', 'E2E-PRODUCT',
  10, 0, '2026-01-15T00:00:00Z', 'HIGH', 'PLANNED'
);

insert into production_tasks(
  id, order_id, operation_id, operation_sequence, status,
  planned_start, planned_end, planned_quantity, actual_quantity,
  version, quality_required, quality_status
) values (
  'E2E-TASK', 'E2E-ORDER', 'E2E-OP-10', 10, 'READY',
  '2026-01-02T08:00:00Z', '2026-01-02T10:00:00Z', 10, 0,
  1, true, 'NOT_REQUIRED'
);

select is(
  (select status from production_orders where id = 'E2E-ORDER'),
  'PLANNED',
  'new order starts in PLANNED'
);

select is(
  (select status from production_tasks where id = 'E2E-TASK'),
  'READY',
  'new task starts in READY'
);

select (mes_change_order_status(
  'E2E-ORDER', 'RELEASED', 'PLANNED', 0
)).id;

select is(
  (select status from production_orders where id = 'E2E-ORDER'),
  'RELEASED',
  'order is released through optimistic-lock RPC'
);

select (mes_execute_task_action(
  'E2E-TASK', 'START', '2026-01-02T08:00:00Z'
)).id;

select is(
  (select status from production_tasks where id = 'E2E-TASK'),
  'RUNNING',
  'task enters RUNNING through execution RPC'
);
select is(
  (select status from production_orders where id = 'E2E-ORDER'),
  'IN_EXECUTION',
  'order follows task execution state'
);

select (mes_request_quality_check('E2E-TASK')).id;

select is(
  (select quality_status from production_tasks where id = 'E2E-TASK'),
  'PENDING',
  'quality gate enters PENDING'
);

select (mes_record_production_result(
  'E2E-TASK', 5, 0, '[]'::jsonb, 'first batch', '2026-01-02T09:00:00Z'
)).id;

select is(
  (select actual_quantity from production_tasks where id = 'E2E-TASK'),
  5::numeric,
  'first production fact is accumulated on task'
);
select is(
  (select status from production_tasks where id = 'E2E-TASK'),
  'PARTIALLY_COMPLETED',
  'partial production moves task to PARTIALLY_COMPLETED'
);
select is(
  (select status from production_orders where id = 'E2E-ORDER'),
  'PARTIALLY_COMPLETED',
  'order fact/status follows partial last-operation fact'
);
select is(
  (select completed_quantity from production_orders where id = 'E2E-ORDER'),
  5::numeric,
  'order completed quantity follows last operation fact'
);

select (mes_submit_quality_inspection(
  'E2E-TASK', 'APPROVED', 5, 0, null, 'first batch approved', '2026-01-02T09:10:00Z'
)).id;

select is(
  (select quality_status from production_tasks where id = 'E2E-TASK'),
  'APPROVED',
  'partial quantity receives APPROVED quality decision'
);
select is(
  (select status from production_tasks where id = 'E2E-TASK'),
  'PARTIALLY_COMPLETED',
  'partial approved quantity does not complete task early'
);

select (mes_record_production_result(
  'E2E-TASK', 5, 0, '[]'::jsonb, 'final batch', '2026-01-02T10:00:00Z'
)).id;

select is(
  (select actual_quantity from production_tasks where id = 'E2E-TASK'),
  10::numeric,
  'final production fact reaches planned quantity'
);
select is(
  (select status from production_tasks where id = 'E2E-TASK'),
  'COMPLETED',
  'approved quality-controlled task completes at full fact'
);
select is(
  (select quality_status from production_tasks where id = 'E2E-TASK'),
  'APPROVED',
  'completion retains approved quality state'
);
select is(
  (select completed_quantity from production_orders where id = 'E2E-ORDER'),
  10::numeric,
  'order fact reaches planned quantity'
);
select is(
  (select status from production_orders where id = 'E2E-ORDER'),
  'COMPLETED',
  'order completes from authoritative last-operation fact'
);

select ok(
  (select count(*) from production_results where task_id = 'E2E-TASK') = 2,
  'two append-only production facts were recorded'
);
select ok(
  (select count(*) from quality_inspections where task_id = 'E2E-TASK' and status = 'APPROVED') = 1,
  'one approved quality inspection was recorded'
);
select ok(
  (select count(*) from production_events where task_id = 'E2E-TASK') >= 4,
  'execution and result events were emitted'
);
select ok(
  (select count(*) from audit_log where entity_id = 'E2E-ORDER') >= 1,
  'order lifecycle produced an audit record'
);

select * from finish();
