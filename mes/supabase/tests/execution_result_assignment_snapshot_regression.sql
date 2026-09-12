select no_plan();

-- Production facts must retain the server-side assignment snapshot when the UI
-- does not provide equipment ids. The client must not be able to invent resources.
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","app_metadata":{"mes_role":"ADMIN"}}',
  false
);

insert into operational_plans(id, version, horizon_start, horizon_end, status)
values ('RS-PLAN', 1, '2026-03-01T00:00:00Z', '2026-03-31T00:00:00Z', 'DRAFT');
insert into products(id, code, name, unit)
values ('RS-PROD', 'RS-PROD', 'Result Snapshot Product', 'шт');
insert into employees(id, personnel_no, name, profession, qualification_level, active)
values ('RS-EMP', 'RS-001', 'Result Snapshot Employee', 'Оператор', 3, true);
insert into equipment(id, code, name, work_center, capabilities, active)
values ('RS-EQ', 'RS-EQ', 'Result Snapshot Equipment', 'RS-WC', '[]'::jsonb, true);
insert into production_orders(id, external_id, number, plan_id, product_id, quantity, completed_quantity, due_at, priority, status)
values ('RS-ORDER', 'RS-EXT', 'RS-001', 'RS-PLAN', 'RS-PROD', 10, 0, '2026-03-10T00:00:00Z', 'NORMAL', 'IN_EXECUTION');
insert into production_tasks(id, order_id, operation_id, operation_sequence, status, planned_start, planned_end,
                             planned_quantity, actual_quantity, version, quality_required, quality_status)
values ('RS-TASK', 'RS-ORDER', 'RS-OP', 10, 'RUNNING',
        '2026-03-02T08:00:00Z', '2026-03-02T10:00:00Z', 10, 0, 1, false, 'NOT_REQUIRED');
insert into task_assignments(task_id, employee_id, equipment_id)
values ('RS-TASK', 'RS-EMP', 'RS-EQ');

select (mes_record_production_result(
  'RS-TASK', 3, 1, '[]'::jsonb, 'server derives assigned equipment', '2026-03-02T08:30:00Z'
)).id;

select is(
  (select equipment_ids from production_results where task_id = 'RS-TASK' order by recorded_at desc limit 1),
  '["RS-EQ"]'::jsonb,
  'result without equipmentIds keeps assigned equipment snapshot'
);
select is(
  (select employee_ids from production_results where task_id = 'RS-TASK' order by recorded_at desc limit 1),
  '["RS-EMP"]'::jsonb,
  'result stores the assigned employee snapshot'
);
select is(
  (select actual_quantity from production_tasks where id = 'RS-TASK'),
  3::numeric,
  'good quantity is accumulated independently of the resource snapshot'
);

select throws_ok(
  $$select mes_record_production_result('RS-TASK', 1, 0, '["RS-OTHER"]'::jsonb, null, '2026-03-02T08:40:00Z')$$,
  'Оборудование RS-OTHER не назначено на это задание',
  'client cannot claim equipment outside the task assignment'
);

select * from finish();
