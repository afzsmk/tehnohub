select no_plan();

select ok(
  has_table_privilege('authenticated', 'public.production_requests', 'select'),
  'authenticated can select production requests'
);

select ok(
  has_table_privilege('authenticated', 'public.production_request_items', 'select'),
  'authenticated can select production request items'
);

select ok(
  not has_table_privilege('anon', 'public.production_requests', 'select'),
  'anon cannot select production requests'
);

select ok(
  not has_table_privilege('anon', 'public.production_request_items', 'select'),
  'anon cannot select production request items'
);

-- Request -> production order -> planning -> execution.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"mes_role":"ADMIN"}}',
  false
);

insert into operational_plans(id, version, horizon_start, horizon_end, status)
values (
  'REQ-E2E-PLAN',
  1,
  now() - interval '1 hour',
  now() + interval '14 days',
  'DRAFT'
);

insert into products(id, code, name, unit)
values ('REQ-E2E-PRODUCT', 'REQ-E2E', 'Request E2E Product', 'шт');

insert into employees(id, personnel_no, name, profession, qualification_level, active)
values ('REQ-E2E-EMP', 'REQ-E2E-001', 'Request E2E Operator', 'Оператор', 3, true);

insert into shift_definitions(id, name, start_minute, duration_minutes, active)
values ('REQ-E2E-SHIFT', 'REQ-E2E 24h Shift', 0, 1440, true);

insert into calendar_days(date, is_working, shift_ids)
values (current_date, true, '["REQ-E2E-SHIFT"]'::jsonb);

insert into employee_schedules(employee_id, date, shift_ids, status)
values ('REQ-E2E-EMP', current_date, '["REQ-E2E-SHIFT"]'::jsonb, 'WORK');

insert into equipment(id, code, name, work_center, capabilities, active)
values ('REQ-E2E-EQ', 'REQ-E2E-EQ', 'Request E2E Equipment', 'REQ-E2E-WC', '[]'::jsonb, true);

insert into route_operations(
  id, product_id, sequence, code, name, work_center,
  required_qualification, required_equipment_ids,
  labor_norm_hours_per_unit, setup_norm_hours, workers_required,
  setup_minutes, run_minutes_per_unit, active
) values (
  'REQ-E2E-OP-10', 'REQ-E2E-PRODUCT', 10, 'REQ-E2E-OP', 'Request E2E Operation', 'REQ-E2E-WC',
  1, '["REQ-E2E-EQ"]'::jsonb,
  0.01, 0, 1,
  0, 0.6, true
);

select is(
  (mes_create_production_request(
    'REQ-E2E-REQ',
    'REQ-E2E-001',
    'Request E2E Object',
    current_date + 7,
    '[{"product_id":"REQ-E2E-PRODUCT","quantity":5}]'::jsonb
  )->>'status'),
  'NEW',
  'request is created in NEW status'
);

select is(
  (select count(*) from production_request_items where request_id='REQ-E2E-REQ'),
  1::bigint,
  'request item is persisted'
);

select is(
  (mes_create_production_order_from_request_item(
    (select id from production_request_items where request_id='REQ-E2E-REQ' order by line_no limit 1),
    'REQ-E2E-ORDER-ID',
    'REQ-E2E-ORDER',
    'REQ-E2E-PLAN',
    now() + interval '7 days',
    'HIGH'
  )->>'created'),
  'true',
  'production order is created from request item'
);

select is(
  (select source_request_item_id from production_orders where id='REQ-E2E-ORDER-ID'),
  (select id from production_request_items where request_id='REQ-E2E-REQ' order by line_no limit 1),
  'production order keeps request item provenance'
);

select is(
  (select status from production_requests where id='REQ-E2E-REQ'),
  'PLANNED',
  'single-item request becomes planned after order creation'
);

select is(
  (mes_create_production_order_from_request_item(
    (select id from production_request_items where request_id='REQ-E2E-REQ' order by line_no limit 1),
    'REQ-E2E-DUP-ID',
    'REQ-E2E-DUP',
    'REQ-E2E-PLAN',
    now() + interval '7 days',
    'HIGH'
  )->>'created'),
  'false',
  'repeated conversion is idempotent for the active request item order'
);

select is(
  (mes_plan_order('REQ-E2E-ORDER-ID')->>'createdTasks')::integer,
  1,
  'request-created order receives one planned task'
);

select is(
  (select status from production_orders where id='REQ-E2E-ORDER-ID'),
  'PLANNED',
  'planned order status is synchronized after task planning'
);

select (mes_change_order_status('REQ-E2E-ORDER-ID', 'RELEASED', 'PLANNED', 0)).id;

select ((mes_assign_task(
  (select id from production_tasks where order_id='REQ-E2E-ORDER-ID' limit 1),
  '["REQ-E2E-EMP"]'::jsonb,
  '["REQ-E2E-EQ"]'::jsonb,
  1
))).id;

select ((mes_prepare_task(
  (select id from production_tasks where order_id='REQ-E2E-ORDER-ID' limit 1),
  2
))).id;

select (
  mes_execute_task_action(
    (select id from production_tasks where order_id='REQ-E2E-ORDER-ID' limit 1),
    'START',
    now()
  )
).id;

select is(
  (select status from production_tasks where order_id='REQ-E2E-ORDER-ID'),
  'RUNNING',
  'request-created task enters RUNNING'
);

select (
  mes_record_production_result(
    (select id from production_tasks where order_id='REQ-E2E-ORDER-ID' limit 1),
    5,
    0,
    '["REQ-E2E-EQ"]'::jsonb,
    'request lifecycle final result',
    now(),
    'REQ-E2E-RESULT-1'
  )
).id;

select is(
  (select status from production_tasks where order_id='REQ-E2E-ORDER-ID'),
  'COMPLETED',
  'request-created task completes from actual production fact'
);

select is(
  (select actual_quantity from production_tasks where order_id='REQ-E2E-ORDER-ID'),
  5::numeric,
  'request-created task accumulates the requested quantity'
);

select is(
  (select status from production_orders where id='REQ-E2E-ORDER-ID'),
  'COMPLETED',
  'request-created order reaches COMPLETED'
);

select is(
  (select completed_quantity from production_orders where id='REQ-E2E-ORDER-ID'),
  5::numeric,
  'request-created order completed quantity follows the last operation'
);

select ok(
  exists (
    select 1 from audit_log
     where entity_id='REQ-E2E-ORDER-ID'
       and action='CREATED_FROM_PRODUCTION_REQUEST'
  ),
  'request-to-order conversion is audited'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.mes_create_production_order_from_request_item(text,text,text,text,timestamp with time zone,text)',
    'execute'
  ),
  'anon cannot execute request-to-order RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.mes_create_production_order_from_request_item(text,text,text,text,timestamp with time zone,text)',
    'execute'
  ),
  'authenticated can execute request-to-order RPC'
);

select * from finish();
