select no_plan();

-- Workforce -> MES contract smoke test.
-- Import is intentionally separate from task planning: the inbound plan creates
-- an operational plan and IMPORTED production orders; mes_plan_order then creates
-- the immutable task graph from the active MES route.

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"mes_role":"ADMIN"}}',
  false
);

-- Use next month dynamically so test never expires when the calendar month rolls over
select set_config('test.wf_month', to_char(now() + interval '1 month', 'YYYY-MM'), false);
select set_config('test.wf_plan_id', 'E2E-WF-' || current_setting('test.wf_month'), false);
select set_config('test.wf_idempotency', 'WF:' || current_setting('test.wf_plan_id') || ':1', false);
select set_config('test.wf_order_id', current_setting('test.wf_plan_id') || ':1:' || current_setting('test.wf_month') || ':E2E-WF-PRODUCT', false);

select ok(
  (mes_import_workforce_plan(
    jsonb_build_object(
      'contractVersion', '1.0',
      'planId', current_setting('test.wf_plan_id'),
      'version', 1,
      'status', 'PUBLISHED',
      'idempotencyKey', current_setting('test.wf_idempotency'),
      'publishedAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'companyExternalId', 'zsmk',
      'siteExternalId', 'zsmk-main',
      'monthlyPlan', jsonb_build_array(
        jsonb_build_object(
          'month', current_setting('test.wf_month'),
          'productExternalId', 'E2E-WF-PRODUCT',
          'quantity', 10
        )
      ),
      'products', jsonb_build_array(
        jsonb_build_object(
          'externalId', 'E2E-WF-PRODUCT',
          'code', 'E2E-WF',
          'name', 'E2E Workforce Product',
          'unit', 'шт'
        )
      ),
      'professions', jsonb_build_array()
    ),
    'workforce:user:e2e'
  )->>'accepted')::boolean,
  'published Workforce plan is accepted by MES'
);

select is(
  (select count(*) from operational_plans where id = current_setting('test.wf_idempotency')),
  1::bigint,
  'import creates one operational plan version'
);

select is(
  (select count(*) from production_orders where external_id = current_setting('test.wf_order_id')),
  1::bigint,
  'import creates one production order'
);

select is(
  (select status from production_orders where external_id = current_setting('test.wf_order_id')),
  'IMPORTED',
  'imported order remains IMPORTED until explicit planning'
);

-- Re-delivery with the same contract identity is accepted but must not duplicate state.
select ok(
  (mes_import_workforce_plan(
    jsonb_build_object(
      'contractVersion', '1.0',
      'planId', current_setting('test.wf_plan_id'),
      'version', 1,
      'status', 'PUBLISHED',
      'idempotencyKey', current_setting('test.wf_idempotency'),
      'publishedAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'publishedBy', 'workforce:user:e2e',
      'monthlyPlan', jsonb_build_array(
        jsonb_build_object(
          'month', current_setting('test.wf_month'),
          'productExternalId', 'E2E-WF-PRODUCT',
          'quantity', 10
        )
      ),
      'products', jsonb_build_array(
        jsonb_build_object(
          'externalId', 'E2E-WF-PRODUCT',
          'code', 'E2E-WF',
          'name', 'E2E Workforce Product',
          'unit', 'шт'
        )
      )
    ),
    'workforce:user:e2e'
  )->>'message' like 'Повторная доставка:%'),
  'duplicate Workforce delivery returns idempotent receipt'
);

select is(
  (select count(*) from production_orders where external_id = current_setting('test.wf_order_id')),
  1::bigint,
  'idempotent re-delivery does not duplicate the production order'
);
select is(
  (select count(*) from integration_messages where idempotency_key = current_setting('test.wf_idempotency')),
  1::bigint,
  'idempotent re-delivery does not duplicate the integration message'
);

-- MES planning remains an explicit operation and uses the authoritative MES route.
insert into route_operations(
  id, product_id, sequence, code, name, work_center,
  required_qualification, required_equipment_ids,
  setup_minutes, run_minutes_per_unit, active
) values (
  'E2E-WF-OP-10',
  'WF-PROD:E2E-WF-PRODUCT',
  10,
  'E2E-WF-OP',
  'E2E Workforce Operation',
  'E2E-WF-WC',
  0,
  '[]'::jsonb,
  5,
  1,
  true
);

select (mes_plan_order(
  current_setting('test.wf_order_id')
))->'createdTasks';

select is(
  (select status from production_orders where external_id = current_setting('test.wf_order_id')),
  'PLANNED',
  'explicit MES planning moves imported order to PLANNED'
);
select is(
  (select count(*) from production_tasks where order_id = current_setting('test.wf_order_id')),
  1::bigint,
  'explicit MES planning creates task graph from active route'
);
select is(
  (select operation_id from production_tasks where order_id = current_setting('test.wf_order_id') limit 1),
  'E2E-WF-OP-10',
  'created task references the active MES route operation'
);

select * from finish();
