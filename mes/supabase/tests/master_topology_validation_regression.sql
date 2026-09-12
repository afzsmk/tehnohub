select no_plan();

select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select set_config('request.jwt.claims','{"sub":"33333333-3333-3333-3333-333333333333","app_metadata":{"mes_role":"ADMIN"}}',false);

select ok(
  (mes_validate_bootstrap_topology(jsonb_build_object(
    'products',jsonb_build_array(
      jsonb_build_object('id','TV-P1','code','TV-P1','name','P1','unit','шт'),
      jsonb_build_object('id','TV-P2','code','TV-P2','name','P2','unit','шт')
    ),
    'work_centers',jsonb_build_array(jsonb_build_object('id','TV-WC','code','TV-WC','name','WC','active',true)),
    'routes',jsonb_build_array(jsonb_build_object('id','TV-R1','product_id','TV-P1','code','TV-R1','name','R1','version',1,'active',true)),
    'equipment',jsonb_build_array(jsonb_build_object('id','TV-EQ','code','TV-EQ','name','EQ','work_center','TV-WC','active',true)),
    'qualification_levels',jsonb_build_array(jsonb_build_object('id','TV-Q','code','TV-Q','name','Q','level',3,'active',true)),
    'route_operations',jsonb_build_array(jsonb_build_object('id','TV-OP','product_id','TV-P1','route_id','TV-R1','sequence',10,'code','TV-OP','name','OP','work_center','TV-WC','required_qualification_id','TV-Q','required_equipment_ids',jsonb_build_array('TV-EQ')))
  ))->>'valid')::boolean,
  'normalized topology validator accepts internally consistent route-operation identity'
);

select ok(
  not ((mes_validate_bootstrap_topology(jsonb_build_object(
    'products',jsonb_build_array(
      jsonb_build_object('id','TV-P1','code','TV-P1','name','P1','unit','шт'),
      jsonb_build_object('id','TV-P2','code','TV-P2','name','P2','unit','шт')
    ),
    'work_centers',jsonb_build_array(jsonb_build_object('id','TV-WC','code','TV-WC','name','WC','active',true)),
    'routes',jsonb_build_array(jsonb_build_object('id','TV-R1','product_id','TV-P1','code','TV-R1','name','R1','version',1,'active',true)),
    'route_operations',jsonb_build_array(jsonb_build_object('id','TV-OP','product_id','TV-P2','route_id','TV-R1','sequence',10,'code','TV-OP','name','OP','work_center','TV-WC'))
  ))->>'valid')::boolean),
  'normalized topology validator rejects route-operation/product mismatch'
);

select ok(
  position('product_id' in (mes_validate_bootstrap_topology(jsonb_build_object(
    'products',jsonb_build_array(jsonb_build_object('id','TV-P1','code','TV-P1','name','P1','unit','шт'),jsonb_build_object('id','TV-P2','code','TV-P2','name','P2','unit','шт')),
    'routes',jsonb_build_array(jsonb_build_object('id','TV-R1','product_id','TV-P1','code','TV-R1','name','R1','version',1,'active',true)),
    'route_operations',jsonb_build_array(jsonb_build_object('id','TV-OP','product_id','TV-P2','route_id','TV-R1','sequence',10,'code','TV-OP','name','OP'))
  ))->>'errors')) > 0,
  'validator reports route-operation product identity error'
);

select * from finish();
