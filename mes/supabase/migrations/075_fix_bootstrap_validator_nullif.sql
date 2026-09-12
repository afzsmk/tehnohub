-- Corrective migration for 073_mes_master_reference_import_v2.
-- The original validator used NULLIF(text) in two places. PostgreSQL's
-- two-argument NULLIF is required; the bad statement was only exposed when
-- PL/pgSQL lazily compiled the corresponding branch during an authenticated call.

create or replace function mes_validate_bootstrap(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  r jsonb;
  v_id text;
  v_n integer;
begin
  perform mes_require_master_editor();

  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    return jsonb_build_object(
      'valid',false,
      'errors',jsonb_build_array('payload должен быть JSON object'),
      'warnings','[]'::jsonb
    );
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'professions','[]'::jsonb)) loop
    v_id := nullif(trim(r->>'id'),'');
    if v_id is null
       or nullif(trim(r->>'code'),'') is null
       or nullif(trim(r->>'name'),'') is null then
      v_errors := v_errors || jsonb_build_array(format('Profession %s: требуются id, code, name',coalesce(v_id,'?')));
    end if;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'qualification_levels','[]'::jsonb)) loop
    v_id := nullif(trim(r->>'id'),'');
    if v_id is null
       or nullif(trim(r->>'code'),'') is null
       or nullif(trim(r->>'name'),'') is null then
      v_errors := v_errors || jsonb_build_array(format('Qualification %s: требуются id, code, name',coalesce(v_id,'?')));
    end if;
    if coalesce((r->>'level')::integer,-1) < 0 then
      v_errors := v_errors || jsonb_build_array(format('Qualification %s: некорректный level',coalesce(v_id,'?')));
    end if;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'brigades','[]'::jsonb)) loop
    v_id := nullif(trim(r->>'id'),'');
    if v_id is null
       or nullif(trim(r->>'code'),'') is null
       or nullif(trim(r->>'name'),'') is null then
      v_errors := v_errors || jsonb_build_array(format('Brigade %s: требуются id, code, name',coalesce(v_id,'?')));
    end if;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'employees','[]'::jsonb)) loop
    v_id := nullif(trim(r->>'id'),'');
    if v_id is null
       or nullif(trim(r->>'personnel_no'),'') is null
       or nullif(trim(r->>'name'),'') is null then
      v_errors := v_errors || jsonb_build_array(format('Employee %s: требуются id, personnel_no, name',coalesce(v_id,'?')));
    end if;

    if nullif(trim(r->>'profession_id'),'') is not null
       and not exists (
         select 1 from jsonb_array_elements(coalesce(p_payload->'professions','[]'::jsonb)) x
         where trim(x->>'id') = trim(r->>'profession_id')
       )
       and not exists (select 1 from professions where id = trim(r->>'profession_id')) then
      v_errors := v_errors || jsonb_build_array(format('Employee %s: profession %s отсутствует',v_id,r->>'profession_id'));
    end if;

    if nullif(trim(r->>'brigade_id'),'') is not null
       and not exists (
         select 1 from jsonb_array_elements(coalesce(p_payload->'brigades','[]'::jsonb)) x
         where trim(x->>'id') = trim(r->>'brigade_id')
       )
       and not exists (select 1 from brigades where id = trim(r->>'brigade_id')) then
      v_errors := v_errors || jsonb_build_array(format('Employee %s: brigade %s отсутствует',v_id,r->>'brigade_id'));
    end if;

    if nullif(trim(r->>'qualification_id'),'') is not null
       and not exists (
         select 1 from jsonb_array_elements(coalesce(p_payload->'qualification_levels','[]'::jsonb)) x
         where trim(x->>'id') = trim(r->>'qualification_id')
       )
       and not exists (select 1 from qualification_levels where id = trim(r->>'qualification_id')) then
      v_errors := v_errors || jsonb_build_array(format('Employee %s: qualification %s отсутствует',v_id,r->>'qualification_id'));
    end if;
  end loop;

  select count(*) into v_n
  from jsonb_array_elements(coalesce(p_payload->'employees','[]'::jsonb)) x
  where nullif(trim(x->>'id'),'') is not null;

  if v_n <> (
    select count(distinct nullif(trim(x->>'id'),'') )
    from jsonb_array_elements(coalesce(p_payload->'employees','[]'::jsonb)) x
  ) then
    v_errors := v_errors || jsonb_build_array('Employees: найдены дублирующиеся id');
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'employee_qualifications','[]'::jsonb)) loop
    if nullif(trim(r->>'employee_id'),'') is null
       or nullif(trim(r->>'qualification_id'),'') is null then
      v_errors := v_errors || jsonb_build_array('Employee qualifications: требуются employee_id и qualification_id');
    end if;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'downtime_reasons','[]'::jsonb)) loop
    if nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null then
      v_errors := v_errors || jsonb_build_array('Downtime reason: требуются code и name');
    end if;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'scrap_reasons','[]'::jsonb)) loop
    if nullif(trim(r->>'code'),'') is null or nullif(trim(r->>'name'),'') is null then
      v_errors := v_errors || jsonb_build_array('Scrap reason: требуются code и name');
    end if;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'products','[]'::jsonb)) loop
    v_id := nullif(trim(r->>'id'),'');
    if v_id is null
       or nullif(trim(r->>'code'),'') is null
       or nullif(trim(r->>'name'),'') is null
       or nullif(trim(r->>'unit'),'') is null then
      v_errors := v_errors || jsonb_build_array(format('Product %s: требуются id, code, name, unit',coalesce(v_id,'?')));
    end if;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'equipment','[]'::jsonb)) loop
    v_id := nullif(trim(r->>'id'),'');
    if v_id is null
       or nullif(trim(r->>'code'),'') is null
       or nullif(trim(r->>'name'),'') is null
       or nullif(trim(r->>'work_center'),'') is null then
      v_errors := v_errors || jsonb_build_array(format('Equipment %s: требуются id, code, name, work_center',coalesce(v_id,'?')));
    end if;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'shifts','[]'::jsonb)) loop
    v_id := nullif(trim(r->>'id'),'');
    if v_id is null or nullif(trim(r->>'name'),'') is null then
      v_errors := v_errors || jsonb_build_array(format('Shift %s: требуются id и name',coalesce(v_id,'?')));
    end if;
    if coalesce((r->>'start_minute')::integer,-1) < 0
       or coalesce((r->>'start_minute')::integer,-1) > 1439 then
      v_errors := v_errors || jsonb_build_array(format('Shift %s: некорректный start_minute',coalesce(v_id,'?')));
    end if;
    if coalesce((r->>'duration_minutes')::integer,0) <= 0
       or coalesce((r->>'duration_minutes')::integer,0) > 1440 then
      v_errors := v_errors || jsonb_build_array(format('Shift %s: некорректная duration_minutes',coalesce(v_id,'?')));
    end if;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_payload->'route_operations','[]'::jsonb)) loop
    v_id := nullif(trim(r->>'id'),'');
    if v_id is null
       or nullif(trim(r->>'product_id'),'') is null
       or nullif(trim(r->>'code'),'') is null
       or nullif(trim(r->>'name'),'') is null
       or nullif(trim(r->>'work_center'),'') is null then
      v_errors := v_errors || jsonb_build_array(format('Route operation %s: обязательны id/product_id/code/name/work_center',coalesce(v_id,'?')));
    end if;

    if coalesce((r->>'sequence')::integer,0) <= 0 then
      v_errors := v_errors || jsonb_build_array(format('Route operation %s: некорректный sequence',coalesce(v_id,'?')));
    end if;

    if coalesce((r->>'workers_required')::integer,0) <= 0 then
      v_errors := v_errors || jsonb_build_array(format('Route operation %s: workers_required должен быть > 0',coalesce(v_id,'?')));
    end if;

    if coalesce((r->>'labor_norm_hours_per_unit')::numeric,0) < 0
       or coalesce((r->>'setup_norm_hours')::numeric,0) < 0
       or (coalesce((r->>'labor_norm_hours_per_unit')::numeric,0) = 0
           and coalesce((r->>'setup_norm_hours')::numeric,0) = 0) then
      v_errors := v_errors || jsonb_build_array(format('Route operation %s: нормы н-ч должны быть неотрицательны и не могут одновременно быть 0',coalesce(v_id,'?')));
    end if;

    if not exists (
      select 1 from jsonb_array_elements(coalesce(p_payload->'products','[]'::jsonb)) x
      where trim(x->>'id') = trim(r->>'product_id')
    )
    and not exists (select 1 from products where id = trim(r->>'product_id')) then
      v_errors := v_errors || jsonb_build_array(format('Route operation %s: продукт %s отсутствует',v_id,r->>'product_id'));
    end if;
  end loop;

  return jsonb_build_object(
    'valid',jsonb_array_length(v_errors)=0,
    'errors',v_errors,
    'warnings',v_warnings
  );
end;
$$;

grant execute on function mes_validate_bootstrap(jsonb) to authenticated;
