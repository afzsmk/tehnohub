create or replace function public.mes_validate_bootstrap_topology(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_errors jsonb:='[]'::jsonb;
  r jsonb;
  x jsonb;
  v_id text;
  v_route_product text;
  v_wc text;
  v_qual text;
  v_equipment_id text;
  v_equipment_wc text;
  v_equipment_wc_id text;
  v_payload_wc_ok boolean;
begin
  perform mes_require_master_editor();
  for r in select value from jsonb_array_elements(coalesce(p_payload->'work_centers','[]'::jsonb)) loop
    v_id:=nullif(trim(r->>'id'),'');
    if v_id is null or nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null then
      v_errors:=v_errors||jsonb_build_array(format('Work center %s: требуются id, code, name',coalesce(v_id,'?')));
    end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'routes','[]'::jsonb)) loop
    v_id:=nullif(trim(r->>'id'),'');
    if v_id is null or nullif(trim(r->>'product_id'),'') is null or nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null then
      v_errors:=v_errors||jsonb_build_array(format('Route %s: требуются id, product_id, code, name',coalesce(v_id,'?')));
    end if;
    if coalesce((r->>'version')::integer,0)<=0 then
      v_errors:=v_errors||jsonb_build_array(format('Route %s: version должна быть > 0',coalesce(v_id,'?')));
    end if;
    if not exists(select 1 from jsonb_array_elements(coalesce(p_payload->'products','[]'::jsonb)) prod where trim(prod->>'id')=trim(r->>'product_id'))
       and not exists(select 1 from products where id=trim(r->>'product_id')) then
      v_errors:=v_errors||jsonb_build_array(format('Route %s: product %s отсутствует',coalesce(v_id,'?'),r->>'product_id'));
    end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'equipment','[]'::jsonb)) loop
    if nullif(trim(r->>'work_center'),'') is not null then
      if not exists(select 1 from work_centers where (id=trim(r->>'work_center') or code=trim(r->>'work_center') or name=trim(r->>'work_center')) and active=true)
         and not exists(select 1 from jsonb_array_elements(coalesce(p_payload->'work_centers','[]'::jsonb)) wc_json
                        where (trim(wc_json->>'id')=trim(r->>'work_center') or trim(wc_json->>'code')=trim(r->>'work_center') or trim(wc_json->>'name')=trim(r->>'work_center'))
                          and coalesce((wc_json->>'active')::boolean,true)) then
        v_errors:=v_errors||jsonb_build_array(format('Equipment %s: активный work_center %s отсутствует',r->>'id',r->>'work_center'));
      end if;
    end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_payload->'route_operations','[]'::jsonb)) loop
    v_wc:=null;
    if nullif(trim(r->>'route_id'),'') is not null then
      select product_id into v_route_product from routes where id=trim(r->>'route_id') and active=true limit 1;
      if v_route_product is null then
        select trim(route_json->>'product_id') into v_route_product from jsonb_array_elements(coalesce(p_payload->'routes','[]'::jsonb)) route_json
         where trim(route_json->>'id')=trim(r->>'route_id') and coalesce((route_json->>'active')::boolean,true) limit 1;
      end if;
      if v_route_product is null then
        v_errors:=v_errors||jsonb_build_array(format('Route operation %s: активный route %s отсутствует',r->>'id',r->>'route_id'));
      elsif nullif(trim(r->>'product_id'),'') is not null and trim(r->>'product_id')<>v_route_product then
        v_errors:=v_errors||jsonb_build_array(format('Route operation %s: product_id %s не совпадает с product_id маршрута %s',r->>'id',r->>'product_id',v_route_product));
      end if;
    end if;
    if nullif(trim(r->>'work_center'),'') is not null then
      select id into v_wc from work_centers where (id=trim(r->>'work_center') or code=trim(r->>'work_center') or name=trim(r->>'work_center')) and active=true limit 1;
      if v_wc is null then
        select trim(wc_json->>'id') into v_wc from jsonb_array_elements(coalesce(p_payload->'work_centers','[]'::jsonb)) wc_json
         where (trim(wc_json->>'id')=trim(r->>'work_center') or trim(wc_json->>'code')=trim(r->>'work_center') or trim(wc_json->>'name')=trim(r->>'work_center'))
           and coalesce((wc_json->>'active')::boolean,true) limit 1;
      end if;
      if v_wc is null then
        v_errors:=v_errors||jsonb_build_array(format('Route operation %s: активный work_center %s отсутствует',r->>'id',r->>'work_center'));
      end if;
    end if;
    v_qual:=null;
    if nullif(trim(r->>'required_qualification_id'),'') is not null then
      select id into v_qual from qualification_levels where (id=trim(r->>'required_qualification_id') or code=trim(r->>'required_qualification_id') or name=trim(r->>'required_qualification_id')) and active=true limit 1;
      if v_qual is null then
        select trim(qual_json->>'id') into v_qual from jsonb_array_elements(coalesce(p_payload->'qualification_levels','[]'::jsonb)) qual_json
         where (trim(qual_json->>'id')=trim(r->>'required_qualification_id') or trim(qual_json->>'code')=trim(r->>'required_qualification_id') or trim(qual_json->>'name')=trim(r->>'required_qualification_id'))
           and coalesce((qual_json->>'active')::boolean,true) limit 1;
      end if;
      if v_qual is null then
        v_errors:=v_errors||jsonb_build_array(format('Route operation %s: активная qualification %s отсутствует',r->>'id',r->>'required_qualification_id'));
      end if;
    end if;
    if jsonb_typeof(coalesce(r->'required_equipment_ids','[]'::jsonb))<>'array' then
      v_errors:=v_errors||jsonb_build_array(format('Route operation %s: required_equipment_ids должен быть массивом',r->>'id'));
    else
      for x in select value from jsonb_array_elements(coalesce(r->'required_equipment_ids','[]'::jsonb)) loop
        if jsonb_typeof(x)<>'string' then
          v_errors:=v_errors||jsonb_build_array(format('Route operation %s: required_equipment_ids должен содержать только строки',r->>'id'));
        else
          v_equipment_id:=trim(x#>>'{}'); if v_equipment_id='' then continue; end if;
          v_equipment_wc:=null; v_equipment_wc_id:=null;
          select e.work_center,e.work_center_id into v_equipment_wc,v_equipment_wc_id from equipment e where e.id=v_equipment_id and e.active limit 1;
          if v_equipment_wc is null and v_equipment_wc_id is null then
            select coalesce(ej->>'work_center',''),coalesce(ej->>'work_center_id','') into v_equipment_wc,v_equipment_wc_id from jsonb_array_elements(coalesce(p_payload->'equipment','[]'::jsonb)) ej where trim(ej->>'id')=v_equipment_id and coalesce((ej->>'active')::boolean,true) limit 1;
          end if;
          if v_equipment_wc is null and v_equipment_wc_id is null then
            v_errors:=v_errors||jsonb_build_array(format('Route operation %s: активное оборудование %s отсутствует',r->>'id',v_equipment_id));
          elsif v_wc is not null then
            if nullif(trim(v_equipment_wc_id),'') is not null then
              if trim(v_equipment_wc_id)<>trim(v_wc) then
                v_errors:=v_errors||jsonb_build_array(format('Route operation %s: оборудование %s относится к другому рабочему центру',r->>'id',v_equipment_id));
              end if;
            elsif nullif(trim(v_equipment_wc),'') is not null then
              v_payload_wc_ok:=trim(v_equipment_wc)=trim(v_wc);
              if not v_payload_wc_ok then
                v_payload_wc_ok:=exists(select 1 from work_centers w where w.id=v_wc and (w.id=trim(v_equipment_wc) or w.name=trim(v_equipment_wc) or w.code=trim(v_equipment_wc)));
              end if;
              if not v_payload_wc_ok then
                v_payload_wc_ok:=exists(select 1 from jsonb_array_elements(coalesce(p_payload->'work_centers','[]'::jsonb)) wj where trim(wj->>'id')=trim(v_wc) and coalesce((wj->>'active')::boolean,true) and (trim(wj->>'id')=trim(v_equipment_wc) or trim(wj->>'name')=trim(v_equipment_wc) or trim(wj->>'code')=trim(v_equipment_wc)));
              end if;
              if not v_payload_wc_ok then
                v_errors:=v_errors||jsonb_build_array(format('Route operation %s: оборудование %s относится к другому рабочему центру',r->>'id',v_equipment_id));
              end if;
            end if;
          end if;
        end if;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('valid',jsonb_array_length(v_errors)=0,'errors',v_errors,'warnings','[]'::jsonb);
end;
$$;