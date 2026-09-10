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

select ok(
  (mes_import_workforce_plan(
    jsonb_build_object(
      'contractVersion', '1.0',
      'planId', 'E2E-WF-2026-09',
      'version', 1,
      'status', 'PUBLISHED',
      'idempotencyKey', 'WF:E2E-WF-2026-09:1',
      'publishedAt', '2026-09-10T10:00:00Z',
      'publishedBy', 'workforce:user:e2e',
      'companyExternalId', 'zsmk',
      'siteExternalId', 'zsmk-main',
      'monthlyPlan', jsonb_build_array(
        jsonb_build_object(
          'month', '2026-09',
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
  (select count(*) from operational_plans where id = 'WF:E2E-WF-2026-09:1'),
  1::bigint,
  'import creates one operational plan version'
);

select is(
  (select count(*) from production_orders where external_id = 'E2E-WF-2026-09:1:2026-09:E2E-WF-PRODUCT'),
  1::bigint,
  'import creates one production order'
);

select is(
  (select status from production_orders where external_id = 'E2E-WF-2026-09:1:2026-09:E2E-WF-PRODUCT'),
  'IMPORTED',
  'imported order remains IMPORTED until explicit planning'
);

-- Re-delivery with the same contract identity is accepted but must not duplicate state.
select ok(
  (mes_import_workforce_plan(
    jsonb_build_object(
      'contractVersion', '1.0',
      'planId', 'E2E-WF-2026-09',
      'version', 1,
      'status', 'PUBLISHED',
      'idempotencyKey', 'WF:E2E-WF-2026-09:1',
      'publishedAt', '2026-09-10T10:00:00Z',
      'publishedBy', 'workforce:user:e2e',
      'monthlyPlan', jsonb_build_array(
        jsonb_build_object(
          'month', '2026-09',
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
  (select count(*) from production_orders where external_id = 'E2E-WF-2026-09:1:2026-09:E2E-WF-PRODUCT'),
  1::bigint,
  'idempotent re-delivery does not duplicate the production order'
);
select is(
  (select count(*) from integration_messages where idempotency_key = 'WF:E2E-WF-2026-09:1'),
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
  'E2E-WF-2026-09:1:2026-09:E2E-WF-PRODUCT'
))->'createdTasks';

select is(
  (select status from production_orders where external_id = 'E2E-WF-2026-09:1:2026-09:E2E-WF-PRODUCT'),
  'PLANNED',
  'explicit MES planning moves imported order to PLANNED'
);
select is(
  (select count(*) from production_tasks where order_id = 'E2E-WF-2026-09:1:2026-09:E2E-WF-PRODUCT'),
  1::bigint,
  'explicit MES planning creates task graph from active route'
);
select is(
  (select operation_id from production_tasks where order_id = 'E2E-WF-2026-09:1:2026-09:E2E-WF-PRODUCT' limit 1),
  'E2E-WF-OP-10',
  'created task references the active MES route operation'
);

select * from finish();
