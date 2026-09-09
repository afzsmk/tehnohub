-- Automatically bridge append-only MES execution events into the Workforce outbox.
-- The trigger runs in the same DB transaction as the production event, so a
-- committed execution event cannot exist without its outbound delivery record.

create or replace function mes_enqueue_workforce_event_from_production_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id text;
  v_plan_id text;
  v_plan_version integer;
  v_product_external_id text;
  v_equipment_external_id text;
  v_quantity_good numeric;
  v_quantity_scrap numeric;
  v_result_id text;
  v_event_type text;
  v_payload jsonb;
begin
  -- PREPARE, START, PAUSE, RESUME are internal execution states and are not
  -- sent upstream by the current contract. Keep only events with a Workforce
  -- feedback representation.
  if NEW.type not in ('TASK_COMPLETED','RESULT_RECORDED','DOWNTIME_STARTED','DOWNTIME_ENDED','MAINTENANCE_STARTED','MAINTENANCE_COMPLETED') then
    return NEW;
  end if;

  if NEW.type = 'TASK_COMPLETED' then
    v_event_type := 'TASK_COMPLETED';
  elsif NEW.type = 'RESULT_RECORDED' then
    v_event_type := 'RESULT_RECORDED';
  elsif NEW.type in ('DOWNTIME_STARTED','DOWNTIME_ENDED') then
    v_event_type := 'DOWNTIME';
  else
    v_event_type := 'MAINTENANCE';
  end if;

  if NEW.task_id is not null then
    select o.id, o.plan_id, p.external_id
      into v_order_id, v_plan_id, v_product_external_id
      from production_tasks t
      join production_orders o on o.id = t.order_id
      join products p on p.id = o.product_id
     where t.id = NEW.task_id;
  end if;

  if NEW.type = 'RESULT_RECORDED' then
    v_result_id := NEW.payload->>'resultId';
    select r.good_quantity, r.scrap_quantity
      into v_quantity_good, v_quantity_scrap
      from production_results r
     where r.id = v_result_id;
  end if;

  v_equipment_external_id := coalesce(NEW.payload->>'equipmentExternalId', NEW.payload->>'equipmentId');
  if v_equipment_external_id is not null then
    select coalesce(e.code, e.id)
      into v_equipment_external_id
      from equipment e
     where e.id = v_equipment_external_id;
  end if;

  if v_plan_id is null then
    return NEW;
  end if;

  select version into v_plan_version from operational_plans where id = v_plan_id;

  v_payload := jsonb_build_object(
    'contractVersion', '1.0',
    'eventId', NEW.id,
    'eventType', v_event_type,
    'occurredAt', NEW.occurred_at,
    'mesPlanId', v_plan_id,
    'mesPlanVersion', coalesce(v_plan_version, 1),
    'productionOrderExternalId', case when v_order_id is null then null else coalesce((select external_id from production_orders where id = v_order_id), v_order_id) end,
    'taskId', NEW.task_id,
    'productExternalId', v_product_external_id,
    'quantityGood', v_quantity_good,
    'quantityScrap', v_quantity_scrap,
    'equipmentExternalId', v_equipment_external_id,
    'idempotencyKey', NEW.id,
    'actorId', NEW.actor_id
  );

  insert into integration_outbox (idempotency_key, event_payload)
  values (NEW.id, v_payload)
  on conflict (idempotency_key) do nothing;

  return NEW;
end;
$$;

drop trigger if exists production_event_workforce_outbox on production_events;
create trigger production_event_workforce_outbox
after insert on production_events
for each row execute function mes_enqueue_workforce_event_from_production_event();

comment on function mes_enqueue_workforce_event_from_production_event() is
'Atomically creates a Workforce actual-feedback outbox record for supported append-only MES production events.';
