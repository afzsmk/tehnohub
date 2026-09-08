-- Workforce -> MES import runs inside one PostgreSQL transaction.
-- MES owns this schema; no Workforce tables are referenced directly.

alter table products add column if not exists external_id text;
create unique index if not exists idx_products_external_id on products(external_id) where external_id is not null;

create or replace function mes_import_workforce_plan(p_payload jsonb, p_imported_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract_version text := p_payload->>'contractVersion';
  v_plan_id text := p_payload->>'planId';
  v_version integer := (p_payload->>'version')::integer;
  v_status text := p_payload->>'status';
  v_idempotency text := p_payload->>'idempotencyKey';
  v_operational_plan_id text := concat('WF:', v_plan_id, ':', v_version);
  v_imported_at timestamptz := now();
  v_item jsonb;
  v_product jsonb;
  v_month text;
  v_first_month text;
  v_last_month text;
  v_product_external_id text;
  v_quantity numeric;
  v_order_external_id text;
  v_order_number text;
  v_product_id text;
begin
  if coalesce(trim(p_imported_by), '') = '' then
    raise exception 'importedBy обязателен';
  end if;

  if coalesce(v_contract_version, '') <> '1.0' then
    raise exception 'Неподдерживаемая версия контракта: %', v_contract_version;
  end if;
  if coalesce(v_plan_id, '') = '' or coalesce(v_idempotency, '') = '' then
    raise exception 'planId и idempotencyKey обязательны';
  end if;
  if v_version is null or v_version <= 0 then
    raise exception 'version должен быть положительным';
  end if;
  if v_status <> 'PUBLISHED' then
    raise exception 'Принимаются только опубликованные планы';
  end if;
  if jsonb_typeof(p_payload->'monthlyPlan') <> 'array' or jsonb_array_length(p_payload->'monthlyPlan') = 0 then
    raise exception 'monthlyPlan не должен быть пустым';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_idempotency));

  if exists(select 1 from integration_messages where idempotency_key = v_idempotency) then
    return jsonb_build_object(
      'contractVersion', v_contract_version,
      'idempotencyKey', v_idempotency,
      'sourcePlanId', v_plan_id,
      'sourcePlanVersion', v_version,
      'importedAt', v_imported_at,
      'importedBy', p_imported_by,
      'accepted', true,
      'message', 'Повторная доставка: план уже обработан, повторная запись не выполнена'
    );
  end if;

  select min(item->>'month'), max(item->>'month')
    into v_first_month, v_last_month
    from jsonb_array_elements(p_payload->'monthlyPlan') as item;

  insert into operational_plans (
    id, version, horizon_start, horizon_end, status, source_plan_id, source_plan_version
  )
  values (
    v_operational_plan_id,
    v_version,
    make_timestamptz((split_part(v_first_month, '-', 1))::integer,
                     (split_part(v_first_month, '-', 2))::integer,
                     1, 0, 0, 0, 'UTC'),
    make_timestamptz((split_part(v_last_month, '-', 1))::integer,
                     (split_part(v_last_month, '-', 2))::integer,
                     1, 0, 0, 0, 'UTC') + interval '1 month' - interval '1 second',
    'DRAFT',
    v_plan_id,
    v_version
  );

  for v_product in select * from jsonb_array_elements(coalesce(p_payload->'products', '[]'::jsonb)) loop
    insert into products (id, external_id, code, name, unit)
    values (
      concat('WF-PROD:', v_product->>'externalId'),
      v_product->>'externalId',
      v_product->>'code',
      v_product->>'name',
      v_product->>'unit'
    )
    on conflict (id) do update set
      external_id = excluded.external_id,
      code = excluded.code,
      name = excluded.name,
      unit = excluded.unit;
  end loop;

  for v_item in select * from jsonb_array_elements(p_payload->'monthlyPlan') loop
    v_month := v_item->>'month';
    v_product_external_id := v_item->>'productExternalId';
    v_quantity := (v_item->>'quantity')::numeric;
    v_order_external_id := concat(v_plan_id, ':', v_version, ':', v_month, ':', v_product_external_id);
    v_order_number := concat('WF-', v_plan_id, '-', v_version, '-', replace(v_month, '-', ''), '-', v_product_external_id);
    v_product_id := concat('WF-PROD:', v_product_external_id);

    insert into production_orders (
      id, external_id, number, plan_id, product_id, quantity, completed_quantity, due_at, priority, status
    ) values (
      v_order_external_id,
      v_order_external_id,
      left(v_order_number, 180),
      v_operational_plan_id,
      v_product_id,
      v_quantity,
      0,
      make_timestamptz((split_part(v_month, '-', 1))::integer,
                       (split_part(v_month, '-', 2))::integer,
                       1, 0, 0, 0, 'UTC') + interval '1 month' - interval '1 second',
      'NORMAL',
      'IMPORTED'
    )
    on conflict (external_id) do nothing;
  end loop;

  insert into integration_messages (
    direction, message_type, idempotency_key, received_at, accepted, message, payload
  ) values (
    'INBOUND', 'PLAN_PUBLISHED', v_idempotency, v_imported_at, true, 'План принят и импортирован', p_payload
  );

  return jsonb_build_object(
    'contractVersion', v_contract_version,
    'idempotencyKey', v_idempotency,
    'sourcePlanId', v_plan_id,
    'sourcePlanVersion', v_version,
    'importedAt', v_imported_at,
    'importedBy', p_imported_by,
    'accepted', true,
    'message', 'План принят и импортирован'
  );
exception when unique_violation then
  if exists(select 1 from integration_messages where idempotency_key = v_idempotency) then
    return jsonb_build_object(
      'contractVersion', v_contract_version,
      'idempotencyKey', v_idempotency,
      'sourcePlanId', v_plan_id,
      'sourcePlanVersion', v_version,
      'importedAt', v_imported_at,
      'importedBy', p_imported_by,
      'accepted', true,
      'message', 'Повторная доставка: план уже обработан, повторная запись не выполнена'
    );
  end if;
  raise;
end;
$$;

comment on function mes_import_workforce_plan(jsonb, text) is
'Atomic Workforce -> MES import. Creates plan, master products, orders and integration journal entry in one transaction.';
