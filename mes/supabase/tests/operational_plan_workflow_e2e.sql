select no_plan();

select ok(
  has_function_privilege(
    'authenticated',
    'public.mes_create_operational_plan(text,timestamp with time zone,timestamp with time zone)',
    'execute'
  ),
  'authenticated can create operational plans'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.mes_create_operational_plan(text,timestamp with time zone,timestamp with time zone)',
    'execute'
  ),
  'anon cannot create operational plans'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.mes_create_production_orders_from_request(text,text,text,timestamp with time zone)',
    'execute'
  ),
  'authenticated can form production from a request'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.mes_create_production_orders_from_request(text,text,text,timestamp with time zone)',
    'execute'
  ),
  'anon cannot form production from a request'
);

select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"mes_role":"ADMIN"}}',false);

insert into products(id,code,name,unit)
values('PLAN-E2E-PRODUCT','PLAN-E2E','Operational Plan E2E Product','шт');

insert into route_operations(
  id,product_id,sequence,code,name,work_center,
  required_qualification,required_equipment_ids,
  labor_norm_hours_per_unit,setup_norm_hours,workers_required,
  setup_minutes,run_minutes_per_unit,active
) values(
  'PLAN-E2E-OP-10','PLAN-E2E-PRODUCT',10,'PLAN-E2E-OP','Operational Plan E2E Operation','PLAN-E2E-WC',
  null,'[]'::jsonb,0.01,0,1,0,0.6,true
);

select is(
  (mes_create_operational_plan(
    'PLAN-E2E-001',
    now(),
    now()+interval '30 days'
  )).status,
  'DRAFT',
  'new operational plan starts as DRAFT'
);

select is(
  (mes_create_production_request(
    'PLAN-E2E-REQ','PLAN-E2E-REQ-001','Operational Plan E2E',current_date+14,
    '[{"product_id":"PLAN-E2E-PRODUCT","quantity":10},{"product_id":"PLAN-E2E-PRODUCT","quantity":20}]'::jsonb
  )->>'status'),
  'NEW',
  'request for plan workflow is created'
);

select is(
  (mes_create_production_orders_from_request(
    'PLAN-E2E-REQ','PLAN-E2E-001','HIGH',now()+interval '14 days'
  )->>'createdOrders')::integer,
  2,
  'two request lines produce two orders'
);

select is(
  (select count(*) from production_orders where plan_id='PLAN-E2E-001'),
  2::bigint,
  'two production orders are linked to one operational plan'
);

select is(
  (select count(*) from production_tasks t join production_orders o on o.id=t.order_id where o.plan_id='PLAN-E2E-001'),
  2::bigint,
  'orders receive tasks from the active route'
);

select is(
  (select status from production_requests where id='PLAN-E2E-REQ'),
  'PLANNED',
  'request becomes planned after all lines have active orders'
);

select is(
  (mes_create_production_orders_from_request(
    'PLAN-E2E-REQ','PLAN-E2E-001','HIGH',now()+interval '14 days'
  )->>'createdOrders')::integer,
  0,
  'repeated formation is idempotent'
);

select is(
  (mes_change_operational_plan_status('PLAN-E2E-001','RELEASED',1)).status,
  'RELEASED',
  'operational plan can be released with optimistic version check'
);

select * from finish();