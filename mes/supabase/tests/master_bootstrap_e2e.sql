select no_plan();

-- Full bootstrap smoke test for normalized MES master data.
-- Uses a synthetic, self-contained payload. The test database is reset before the suite,
-- so the fixture never pollutes production data.

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"mes_role":"ADMIN"}}',
  false
);

do $$
declare
  v_payload jsonb := jsonb_build_object(
    'products', jsonb_build_array(
      jsonb_build_object('id','BOOT-PROD-1','code','BOOT-P1','name','Bootstrap product','unit','шт','external_id','BOOT-PROD-EXT-1')
    ),
    'professions', jsonb_build_array(
      jsonb_build_object('id','BOOT-PROF-1','code','BOOT-OP','name','Bootstrap operator','external_id','BOOT-PROF-EXT-1','active',true)
    ),
    'qualification_levels', jsonb_build_array(
      jsonb_build_object('id','BOOT-QUAL-1','code','Q3','name','3 разряд','level',3,'active',true)
    ),
    'brigades', jsonb_build_array(
      jsonb_build_object('id','BOOT-BR-1','code','BOOT-BR-1','name','Bootstrap brigade','active',true)
    ),
    'employees', jsonb_build_array(
      jsonb_build_object(
        'id','BOOT-EMP-1','personnel_no','BOOT-001','name','Bootstrap Worker',
        'profession','BOOT-OP','profession_id','BOOT-PROF-1','brigade_id','BOOT-BR-1',
        'qualification_id','BOOT-QUAL-1','qualification_level',3,'active',true
      )
    ),
    'employee_qualifications', jsonb_build_array(
      jsonb_build_object('employee_id','BOOT-EMP-1','qualification_id','BOOT-QUAL-1','valid_from','2026-01-01','is_primary',true)
    ),
    'work_centers', jsonb_build_array(
      jsonb_build_object('id','BOOT-WC-1','code','BOOT-WC','name','Bootstrap work center','site_code','BOOT-SITE','active',true)
    ),
    'equipment', jsonb_build_array(
      jsonb_build_object('id','BOOT-EQ-1','code','BOOT-EQ','name','Bootstrap machine','work_center','BOOT-WC-1','capabilities',jsonb_build_array('CUT'), 'active',true)
    ),
    'equipment_capabilities', jsonb_build_array(
      jsonb_build_object('equipment_id','BOOT-EQ-1','operation_code','BOOT-CUT','capability_level','FULL','valid_from','2026-01-01')
    ),
    'routes', jsonb_build_array(
      jsonb_build_object('id','BOOT-ROUTE-1','external_id','BOOT-ROUTE-EXT-1','product_id','BOOT-PROD-1','code','BOOT-R1','name','Bootstrap route','version',1,'active',true,'valid_from','2026-01-01')
    ),
    'shifts', jsonb_build_array(
      jsonb_build_object('id','BOOT-SHIFT-1','name','Bootstrap shift','start_minute',480,'duration_minutes',480,'active',true)
    ),
    'route_operations', jsonb_build_array(
      jsonb_build_object(
        'id','BOOT-OP-1','product_id','BOOT-PROD-1','route_id','BOOT-ROUTE-1',
        'sequence',10,'code','BOOT-CUT','name','Bootstrap cutting','work_center','BOOT-WC-1',
        'required_qualification',3,'required_qualification_id','BOOT-QUAL-1',
        'required_equipment_ids',jsonb_build_array('BOOT-EQ-1'),
        'setup_norm_hours',0.25,'labor_norm_hours_per_unit',0.05,'workers_required',1,'active',true
      )
    ),
    'downtime_reasons', jsonb_build_array(
      jsonb_build_object('code','BOOT-DOWN-1','name','Bootstrap breakdown','category','UNPLANNED','is_planned',false,'active',true)
    ),
    'scrap_reasons', jsonb_build_array(
      jsonb_build_object('code','BOOT-SCRAP-1','name','Bootstrap defect','category','QUALITY','active',true)
    )
  );
  v_validation jsonb;
  v_result jsonb;
begin
  v_validation := mes_validate_bootstrap(v_payload);
  if coalesce((v_validation->>'valid')::boolean,false) is not true then
    raise exception 'bootstrap validation failed: %', v_validation;
  end if;

  v_result := mes_import_bootstrap('master_bootstrap_e2e.xlsx', v_payload);

  perform ok((select count(*) from products where id='BOOT-PROD-1')=1, 'bootstrap imports product');
  perform ok((select count(*) from professions where id='BOOT-PROF-1')=1, 'bootstrap imports profession');
  perform ok((select count(*) from qualification_levels where id='BOOT-QUAL-1')=1, 'bootstrap imports qualification');
  perform ok((select count(*) from brigades where id='BOOT-BR-1')=1, 'bootstrap imports brigade');
  perform ok((select count(*) from employees where id='BOOT-EMP-1')=1, 'bootstrap imports employee');
  perform ok((select count(*) from employee_qualifications where employee_id='BOOT-EMP-1' and qualification_id='BOOT-QUAL-1')=1, 'bootstrap imports employee qualification');
  perform ok((select count(*) from work_centers where id='BOOT-WC-1')=1, 'bootstrap imports work center');
  perform ok((select count(*) from equipment where id='BOOT-EQ-1')=1, 'bootstrap imports equipment');
  perform ok((select count(*) from equipment_capabilities where equipment_id='BOOT-EQ-1' and operation_code='BOOT-CUT')=1, 'bootstrap imports equipment capability');
  perform ok((select count(*) from routes where id='BOOT-ROUTE-1' and product_id='BOOT-PROD-1' and version=1)=1, 'bootstrap imports route header');
  perform ok((select count(*) from route_operations where id='BOOT-OP-1' and route_id='BOOT-ROUTE-1')=1, 'bootstrap imports route operation bound to route');
  perform ok((select required_qualification from route_operations where id='BOOT-OP-1')=3, 'route operation keeps qualification level');
  perform ok((select labor_norm_hours_per_unit from route_operations where id='BOOT-OP-1')=0.05, 'route operation imports labor norm');
  perform ok((select workers_required from route_operations where id='BOOT-OP-1')=1, 'route operation imports workers required');
  perform ok((select count(*) from downtime_reasons where code='BOOT-DOWN-1')=1, 'bootstrap imports downtime reason');
  perform ok((select count(*) from scrap_reasons where code='BOOT-SCRAP-1')=1, 'bootstrap imports scrap reason');
  perform ok((select count(*) from mes_master_import_runs where source_name='master_bootstrap_e2e.xlsx' and status='COMPLETED')=1, 'bootstrap records completed import run');

  -- Repeated bootstrap delivery must upsert, not duplicate the master records.
  v_result := mes_import_bootstrap('master_bootstrap_e2e.xlsx', v_payload);

  perform ok((select count(*) from products where id='BOOT-PROD-1')=1, 'repeated bootstrap does not duplicate product');
  perform ok((select count(*) from routes where id='BOOT-ROUTE-1')=1, 'repeated bootstrap does not duplicate route');
  perform ok((select count(*) from route_operations where id='BOOT-OP-1')=1, 'repeated bootstrap does not duplicate operation');
  perform ok((select count(*) from equipment_capabilities where equipment_id='BOOT-EQ-1' and operation_code='BOOT-CUT')=1, 'repeated bootstrap does not duplicate capability');
end $$;

select * from finish();
