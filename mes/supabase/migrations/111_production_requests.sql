create table if not exists production_requests (
  id text primary key,
  request_number text not null unique,
  object_name text not null,
  desired_date date not null,
  status text not null default 'NEW' check (status in ('NEW','PLANNED','CANCELLED')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(request_number)) > 0),
  check (length(trim(object_name)) > 0)
);

create table if not exists production_request_items (
  id text primary key,
  request_id text not null references production_requests(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  product_id text not null references products(id),
  quantity numeric(18,3) not null check (quantity > 0),
  unique(request_id,line_no)
);

create index if not exists idx_production_requests_desired_date on production_requests(desired_date);
create index if not exists idx_production_request_items_request on production_request_items(request_id);

alter table production_requests enable row level security;
alter table production_request_items enable row level security;
revoke all on production_requests from anon, authenticated;
revoke all on production_request_items from anon, authenticated;
drop policy if exists production_requests_select on production_requests;
drop policy if exists production_request_items_select on production_request_items;
create policy production_requests_select on production_requests for select to authenticated using (mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']));
create policy production_request_items_select on production_request_items for select to authenticated using (exists(select 1 from production_requests r where r.id=production_request_items.request_id and mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER'])));

create or replace function mes_create_production_request(p_id text,p_request_number text,p_object_name text,p_desired_date date,p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare item jsonb; v_line integer := 0; v_product_id text; v_quantity numeric;
begin
  if auth.uid() is null then raise exception 'MES authentication required'; end if;
  if not mes_has_role(array['ADMIN','PRODUCTION_MANAGER','PLANNER','DISPATCHER','MASTER']) then raise exception 'Недостаточно прав для создания заявки'; end if;
  if nullif(trim(p_id),'') is null or nullif(trim(p_request_number),'') is null or nullif(trim(p_object_name),'') is null or p_desired_date is null then raise exception 'Номер заявки, объект и желаемая дата обязательны'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'Заявка должна содержать хотя бы одну позицию'; end if;
  insert into production_requests(id,request_number,object_name,desired_date,status,created_by)
  values(trim(p_id),trim(p_request_number),trim(p_object_name),p_desired_date,'NEW',auth.uid()::text)
  on conflict(id) do update set request_number=excluded.request_number,object_name=excluded.object_name,desired_date=excluded.desired_date,status='NEW',updated_at=now();
  delete from production_request_items where request_id=trim(p_id);
  for item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    v_product_id := nullif(trim(item->>'product_id'),'');
    v_quantity := (item->>'quantity')::numeric;
    if v_product_id is null or v_quantity is null or v_quantity <= 0 then raise exception 'Некорректная позиция заявки №%',v_line; end if;
    if not exists(select 1 from products where id=v_product_id) then raise exception 'Номенклатура не найдена: %',v_product_id; end if;
    insert into production_request_items(id,request_id,line_no,product_id,quantity) values(gen_random_uuid()::text,trim(p_id),v_line,v_product_id,v_quantity);
  end loop;
  insert into audit_log(actor_id,entity_type,entity_id,action,after_state) values(auth.uid()::text,'PRODUCTION_REQUEST',trim(p_id),'CREATE',jsonb_build_object('request_number',p_request_number,'object_name',p_object_name,'desired_date',p_desired_date,'items',p_items));
  return jsonb_build_object('id',trim(p_id),'request_number',trim(p_request_number),'status','NEW','items_count',v_line);
end;
$$;
grant execute on function mes_create_production_request(text,text,text,date,jsonb) to authenticated;
