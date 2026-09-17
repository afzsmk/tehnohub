select no_plan();

select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"mes_role":"ADMIN"}}',false);

insert into operational_plans(id,version,horizon_start,horizon_end,status)
values('QUAL-E2E-PLAN',1,'2026-09-17T00:00:00Z','2026-09-30T00:00:00Z','DRAFT');
insert into professions(id,code,name,active) values('QUAL-E2E-PROF','OPER','Оператор',true);
insert into qualification_levels(id,code,name,level,active) values
  ('QUAL-E2E-LASER','LASER','Лазерная резка',5,true),
  ('QUAL-E2E-BENDER','BENDER','Гибка',5,true);
insert into employees(id,personnel_no,name,profession,profession_id,qualification_id,qualification_level,active) values
  ('QUAL-E2E-LASER-EMP','QUAL-001','Лазерщик','Оператор','QUAL-E2E-PROF','QUAL-E2E-LASER',5,true),
  ('QUAL-E2E-BENDER-EMP','QUAL-002','Гибщик','Оператор','QUAL-E2E-PROF','QUAL-E2E-BENDER',5,true);
insert into employee_qualifications(employee_id,qualification_id,valid_from,valid_to,is_primary) values
  ('QUAL-E2E-LASER-EMP','QUAL-E2E-LASER',null,null,true),
  ('QUAL-E2E-BENDER-EMP','QUAL-E2E-BENDER',null,null,true);
insert into work_centers(id,code,name,active) values('QUAL-E2E-WC','LASER-WC','Лазерный участок',true);
insert into equipment(id,code,name,work_center,work_center_id,capabilities,active) values
  ('QUAL-E2E-LASER-1','LASER-01','Лазер №1','LASER-WC','QUAL-E2E-WC','[]',true),
  ('QUAL-E2E-LASER-2','LASER-02','Лазер №2','LASER-WC','QUAL-E2E-WC','[]',true);
insert into products(id,code,name,unit) values('QUAL-E2E-PRODUCT','QUAL','Qualification Test Product','шт');
insert into routes(id,product_id,code,name,version,active) values('QUAL-E2E-ROUTE','QUAL-E2E-PRODUCT','QUAL-R1','Qualification Test Route',1,true);
insert into operation_catalog(id,code,name,active) values('QUAL-E2E-OP-CAT','CUT-LASER','Лазерная резка',true);
insert into qualification_equipment_access(qualification_id,equipment_id,notes)
values('QUAL-E2E-LASER','QUAL-E2E-LASER-1','Only laser 1');
insert into route_operations(
  id,product_id,sequence,code,name,work_center,work_center_id,required_qualification,required_qualification_id,
  required_equipment_ids,setup_minutes,run_minutes_per_unit,setup_norm_hours,labor_norm_hours_per_unit,workers_required,active,route_id,operation_id
) values (
  'QUAL-E2E-OP','QUAL-E2E-PRODUCT',10,'CUT-LASER','Лазерная резка','LASER-WC','QUAL-E2E-WC',5,'QUAL-E2E-LASER',
  '[]',0,1,0.1,0.1,1,true,'QUAL-E2E-ROUTE','QUAL-E2E-OP-CAT'
);
insert into production_orders(id,number,plan_id,product_id,quantity,completed_quantity,due_at,priority,status)
values('QUAL-E2E-ORDER','QUAL-E2E-ORDER','QUAL-E2E-PLAN','QUAL-E2E-PRODUCT',1,0,'2026-09-18T18:00:00Z','NORMAL','PLANNED');

insert into production_tasks(id,order_id,operation_id,operation_sequence,status,planned_start,planned_end,planned_quantity,actual_quantity,version)
values('QUAL-E2E-TASK-OK','QUAL-E2E-ORDER','QUAL-E2E-OP',10,'PLANNED','2026-09-18T08:00:00Z','2026-09-18T09:00:00Z',1,0,1);
select ((mes_assign_task('QUAL-E2E-TASK-OK','["QUAL-E2E-LASER-EMP"]'::jsonb,'["QUAL-E2E-LASER-1"]'::jsonb,1))).id;
select is((select count(*) from task_assignments where task_id='QUAL-E2E-TASK-OK' and employee_id='QUAL-E2E-LASER-EMP'),1::bigint,'exact qualified laser operator can be assigned');
select is((select count(*) from task_assignments where task_id='QUAL-E2E-TASK-OK' and equipment_id='QUAL-E2E-LASER-1'),1::bigint,'operator can use explicitly permitted laser');

insert into production_tasks(id,order_id,operation_id,operation_sequence,status,planned_start,planned_end,planned_quantity,actual_quantity,version)
values('QUAL-E2E-TASK-WRONG-Q','QUAL-E2E-ORDER','QUAL-E2E-OP',10,'PLANNED','2026-09-18T09:00:00Z','2026-09-18T10:00:00Z',1,0,1);
select throws_ok(
  $$select mes_assign_task('QUAL-E2E-TASK-WRONG-Q','["QUAL-E2E-BENDER-EMP"]'::jsonb,'["QUAL-E2E-LASER-1"]'::jsonb,1)$$,
  'Сотрудник QUAL-E2E-BENDER-EMP не имеет требуемой квалификации QUAL-E2E-LASER для операции CUT-LASER',
  'different qualification is rejected even on valid equipment'
);

insert into production_tasks(id,order_id,operation_id,operation_sequence,status,planned_start,planned_end,planned_quantity,actual_quantity,version)
values('QUAL-E2E-TASK-WRONG-EQ','QUAL-E2E-ORDER','QUAL-E2E-OP',10,'PLANNED','2026-09-18T10:00:00Z','2026-09-18T11:00:00Z',1,0,1);
select throws_ok(
  $$select mes_assign_task('QUAL-E2E-TASK-WRONG-EQ','["QUAL-E2E-LASER-EMP"]'::jsonb,'["QUAL-E2E-LASER-2"]'::jsonb,1)$$,
  'Квалификация QUAL-E2E-LASER сотрудника QUAL-E2E-LASER-EMP не допускает оборудование QUAL-E2E-LASER-2',
  'exact laser qualification cannot be assigned to another laser machine without an access grant'
);

select is((select count(*) from task_assignments where task_id='QUAL-E2E-TASK-WRONG-Q'),0::bigint,'rejected qualification assignment leaves task unassigned');
select is((select count(*) from task_assignments where task_id='QUAL-E2E-TASK-WRONG-EQ'),0::bigint,'rejected equipment assignment leaves task unassigned');

select * from finish();
