select no_plan();

-- Full bootstrap smoke test for normalized MES master data.
-- Uses a synthetic, self-contained payload. The CI database is reset before the suite,
-- so the fixture never pollutes production data.

select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"mes_role":"ADMIN"}}',false);

create temporary table tmp_bootstrap_payload(payload jsonb) on commit drop;

insert into tmp_bootstrap_payload(payload)
values (jsonb_build_object(
  'products',jsonb_build_array(jsonb_build_object('id','BOOT-PROD-1','code','BOOT-P1','name','Bootstrap product','unit','шт','external_id','BOOT-PROD-EXT-1')),
  'professions',jsonb_build_array(jsonb_build_object('id','BOOT-PROF-1','code','BOOT-OP','name','Bootstrap operator','external_id','BOOT-PROF-EXT-1','active',true)),
  'qualification_levels',jsonb_build_array(jsonb_build_object('id','BOOT-QUAL-1','code','Q3','name','3 разряд','level',3,'active',true)),
  'brigades',jsonb_build_array(jsonb_build_object('id','BOOT-BR-1','code','BOOT-BR-1','name','Bootstrap brigade','active',true)),
  'employees',jsonb_build_array(jsonb_build_object('id','BOOT-EMP-1','personnel_no','BOOT-001','name','Bootstrap Worker','profession','BOOT-OP','profession_id','BOOT-PROF-1','brigade_id','BOOT-BR-1','qualification_id','BOOT-QUAL-1','qualification_level',3,'active',true)),
  'employee_qualifications',jsonb_build_array(jsonb_build_object('employee_id','BOOT-EMP-1','qualification_id','BOOT-QUAL-1','valid_from','2026-01-01','is_primary',true)),
  'work_centers',jsonb_build_array(jsonb_build_object('id','BOOT-WC-1','code','BOOT-WC','name','Bootstrap work center','site_code','BOOT-SITE','active',true)),
  'equipment',jsonb_build_array(jsonb_build_object('id','BOOT-EQ-1','code','BOOT-EQ','name','Bootstrap machine','work_center','BOOT-WC-1','active',true)),
  'equipment_capabilities',jsonb_build_array(jsonb_build_object('equipment_id','BOOT-EQ-1','operation_code','BOOT-CUT','capability_level','FULL','valid_from','2026-01-01')),
  'routes',jsonb_build_array(jsonb_build_object('id','BOOT-ROUTE-1','external_id','BOOT-ROUTE-EXT-1','product_id','BOOT-PROD-1','code','BOOT-R1','name','Bootstrap route','version',1,'active',true,'valid_from','2026-01-01')),
  'shifts',jsonb_build_array(jsonb_build_object('id','BOOT-SHIFT-1','name','Bootstrap shift','start_minute',480,'duration_minutes',480,'active',true)),
  'route_operations',jsonb_build_array(jsonb_build_object('id','BOOT-OP-1','product_id','BOOT-PROD-1','route_id','BOOT-ROUTE-1','sequence',10,'code','BOOT-CUT','name','Bootstrap cutting','work_center','BOOT-WC-1','required_qualification',3,'required_qualification_id','BOOT-QUAL-1','required_equipment_ids',jsonb_build_array('BOOT-EQ-1'),'setup_norm_hours',0.25,'labor_norm_hours_per_unit',0.05,'workers_required',1,'active',true)),
  'downtime_reasons',jsonb_build_array(jsonb_build_object('code','BOOT-DOWN-1','name','Bootstrap breakdown','category','UNPLANNED','is_planned',false,'active',true)),
  'scrap_reasons',jsonb_build_array(jsonb_build_object('code','BOOT-SCRAP-1','name','Bootstrap defect','category','QUALITY','active',true))
));

select ok((mes_validate_bootstrap(payload)->>'valid')::boolean,'bootstrap payload passes server validation') from tmp_bootstrap_payload;
select ok(jsonb_typeof(mes_import_bootstrap('master_bootstrap_e2e.xlsx',payload))='object','bootstrap import returns structured result') from tmp_bootstrap_payload;

select is((select count(*) from products where id='BOOT-PROD-1'),1::bigint,'bootstrap imports product');
select is((select count(*) from professions where id='BOOT-PROF-1'),1::bigint,'bootstrap imports profession');
select is((select count(*) from qualification_levels where id='BOOT-QUAL-1'),1::bigint,'bootstrap imports qualification');
select is((select count(*) from brigades where id='BOOT-BR-1'),1::bigint,'bootstrap imports brigade');
select is((select count(*) from employees where id='BOOT-EMP-1'),1::bigint,'bootstrap imports employee');
select is((select count(*) from employee_qualifications where employee_id='BOOT-EMP-1' and qualification_id='BOOT-QUAL-1'),1::bigint,'bootstrap imports employee qualification');
select is((select count(*) from work_centers where id='BOOT-WC-1'),1::bigint,'bootstrap imports work center');
select is((select count(*) from equipment where id='BOOT-EQ-1'),1::bigint,'bootstrap imports equipment');
select is((select count(*) from equipment_capabilities where equipment_id='BOOT-EQ-1' and operation_code='BOOT-CUT'),1::bigint,'bootstrap imports equipment capability');
select is((select count(*) from routes where id='BOOT-ROUTE-1' and product_id='BOOT-PROD-1' and version=1),1::bigint,'bootstrap imports route header');
select is((select count(*) from route_operations where id='BOOT-OP-1'),1::bigint,'bootstrap imports route operation');
select is((select route_id from route_operations where id='BOOT-OP-1'),'BOOT-ROUTE-1','route operation is bound to normalized route');
select is((select work_center_id from route_operations where id='BOOT-OP-1'),'BOOT-WC-1','route operation is bound to normalized work center');
select is((select required_qualification_id from route_operations where id='BOOT-OP-1'),'BOOT-QUAL-1','route operation keeps normalized qualification reference');
select is((select required_qualification from route_operations where id='BOOT-OP-1'),3,'route operation keeps qualification level mirror');
select is((select labor_norm_hours_per_unit from route_operations where id='BOOT-OP-1'),0.05::numeric,'route operation imports labor norm');
select is((select setup_norm_hours from route_operations where id='BOOT-OP-1'),0.25::numeric,'route operation imports setup norm');
select is((select workers_required from route_operations where id='BOOT-OP-1'),1,'route operation imports workers required');
select is((select count(*) from shift_definitions where id='BOOT-SHIFT-1'),1::bigint,'bootstrap imports shift');
select is((select count(*) from downtime_reasons where code='BOOT-DOWN-1'),1::bigint,'bootstrap imports downtime reason');
select is((select count(*) from scrap_reasons where code='BOOT-SCRAP-1'),1::bigint,'bootstrap imports scrap reason');
select is((select count(*) from mes_master_import_runs where source_name='master_bootstrap_e2e.xlsx' and status='COMPLETED'),1::bigint,'bootstrap records completed import run');

select ok(jsonb_typeof(mes_import_bootstrap('master_bootstrap_e2e.xlsx',payload))='object','repeated bootstrap import returns structured result') from tmp_bootstrap_payload;
select is((select count(*) from products where id='BOOT-PROD-1'),1::bigint,'repeated bootstrap does not duplicate product');
select is((select count(*) from routes where id='BOOT-ROUTE-1'),1::bigint,'repeated bootstrap does not duplicate route');
select is((select count(*) from route_operations where id='BOOT-OP-1'),1::bigint,'repeated bootstrap does not duplicate operation');
select is((select count(*) from equipment_capabilities where equipment_id='BOOT-EQ-1' and operation_code='BOOT-CUT'),1::bigint,'repeated bootstrap does not duplicate capability');

select * from finish();
