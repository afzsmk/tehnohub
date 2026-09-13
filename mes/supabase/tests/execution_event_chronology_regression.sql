select no_plan();

-- Regression coverage for the server-side monotonic task event timeline.
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","app_metadata":{"mes_role":"ADMIN"}}',
  false
);

insert into operational_plans(id, version, horizon_start, horizon_end, status)
values ('EC-PLAN', 1, '2026-04-01T00:00:00Z', '2026-04-30T00:00:00Z', 'DRAFT');

insert into products(id, code, name, unit)
values ('EC-PRODUCT', 'EC-PROD', 'Event Chronology Test Product', 'шт');

insert into production_orders(
  id, external_id, number, plan_id, product_id,
  quantity, completed_quantity, due_at, priority, status
) values (
  'EC-ORDER', 'EC-EXT', 'EC-001', 'EC-PLAN', 'EC-PRODUCT',
  10, 0, '2026-04-10T00:00:00Z', 'NORMAL', 'IN_EXECUTION'
);

insert into production_tasks(
  id, order_id, operation_id, operation_sequence, status,
  planned_start, planned_end, planned_quantity, actual_quantity,
  version, quality_required, quality_status, actual_start
) values (
  'EC-TASK', 'EC-ORDER', 'EC-OP', 10, 'RUNNING',
  '2026-04-02T08:00:00Z', '2026-04-02T10:00:00Z', 10, 0,
  1, false, 'NOT_REQUIRED', '2026-04-02T08:00:00Z'
);

insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
values (
  'EC-EVENT-LATE', 'EC-TASK', 'TASK_STARTED',
  '2026-04-02T09:00:00Z', '44444444-4444-4444-4444-444444444444', '{}'::jsonb
);

select throws_ok(
  $$insert into production_events(id, task_id, type, occurred_at, actor_id, payload)
    values ('EC-EVENT-EARLY', 'EC-TASK', 'TASK_PAUSED',
            '2026-04-02T08:30:00Z', '44444444-4444-4444-4444-444444444444', '{}'::jsonb)$$,
  'Время события раньше последнего события задания',
  'task-linked production events cannot move backward in time'
);

select is(
  (select count(*) from production_events where task_id = 'EC-TASK'),
  1::bigint,
  'rejected out-of-order event is not persisted'
);

select ok(
  has_function_privilege('authenticated', 'public.mes_execute_task_action(text,text,timestamptz)', 'execute'),
  'execution boundary remains available after chronology guard'
);

select * from finish();
