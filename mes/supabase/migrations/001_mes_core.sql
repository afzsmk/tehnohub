-- MES core schema. Deliberately isolated from Workforce and scheduler storage.

create table if not exists operational_plans (
  id text primary key,
  version integer not null check (version > 0),
  horizon_start timestamptz not null,
  horizon_end timestamptz not null,
  status text not null check (status in ('DRAFT','RELEASED','ARCHIVED')),
  source_plan_id text,
  source_plan_version integer check (source_plan_version is null or source_plan_version > 0),
  created_at timestamptz not null default now(),
  check (horizon_end > horizon_start)
);

create table if not exists products (
  id text primary key,
  code text not null unique,
  name text not null,
  unit text not null
);

create table if not exists employees (
  id text primary key,
  personnel_no text not null unique,
  name text not null,
  profession text not null,
  qualification_level integer not null check (qualification_level >= 0),
  active boolean not null default true
);

create table if not exists equipment (
  id text primary key,
  code text not null unique,
  name text not null,
  work_center text not null,
  capabilities jsonb not null default '[]'::jsonb,
  active boolean not null default true
);

create table if not exists production_orders (
  id text primary key,
  external_id text unique,
  number text not null unique,
  plan_id text not null references operational_plans(id),
  product_id text not null references products(id),
  quantity numeric(18,3) not null check (quantity > 0),
  completed_quantity numeric(18,3) not null default 0 check (completed_quantity >= 0),
  due_at timestamptz not null,
  priority text not null check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  status text not null check (status in ('IMPORTED','PLANNED','RELEASED','IN_EXECUTION','PARTIALLY_COMPLETED','COMPLETED','CANCELLED','BLOCKED'))
);

create table if not exists production_tasks (
  id text primary key,
  order_id text not null references production_orders(id),
  operation_id text not null,
  operation_sequence integer not null,
  status text not null check (status in ('DRAFT','PLANNED','ASSIGNED','READY','RUNNING','PAUSED','BLOCKED','PARTIALLY_COMPLETED','COMPLETED','CANCELLED')),
  planned_start timestamptz not null,
  planned_end timestamptz not null,
  actual_start timestamptz,
  actual_end timestamptz,
  planned_quantity numeric(18,3) not null check (planned_quantity > 0),
  actual_quantity numeric(18,3) not null default 0 check (actual_quantity >= 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  check (planned_end > planned_start),
  check (actual_end is null or actual_start is not null),
  check (actual_end is null or actual_start <= actual_end)
);

create table if not exists task_assignments (
  task_id text not null references production_tasks(id) on delete cascade,
  employee_id text references employees(id),
  equipment_id text references equipment(id),
  primary key (task_id, employee_id, equipment_id)
);

create table if not exists equipment_blocks (
  id text primary key,
  equipment_id text not null references equipment(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null check (reason in ('MAINTENANCE','REPAIR','SETUP','OTHER')),
  comment text,
  check (end_at > start_at)
);

create table if not exists downtime_events (
  id text primary key,
  equipment_id text not null references equipment(id),
  reason_code text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  comment text,
  check (ended_at is null or started_at <= ended_at)
);

create table if not exists maintenance_orders (
  id text primary key,
  equipment_id text not null references equipment(id),
  type text not null check (type in ('PM','REPAIR','INSPECTION')),
  planned_start timestamptz not null,
  planned_end timestamptz not null,
  status text not null check (status in ('PLANNED','IN_PROGRESS','DONE','CANCELLED')),
  comment text,
  check (planned_end > planned_start)
);

create table if not exists production_results (
  id text primary key,
  task_id text not null references production_tasks(id),
  recorded_at timestamptz not null,
  good_quantity numeric(18,3) not null check (good_quantity >= 0),
  scrap_quantity numeric(18,3) not null check (scrap_quantity >= 0),
  employee_ids jsonb not null default '[]'::jsonb,
  equipment_ids jsonb not null default '[]'::jsonb,
  comment text,
  check (good_quantity + scrap_quantity > 0)
);

create table if not exists production_events (
  id text primary key,
  task_id text references production_tasks(id),
  type text not null check (type in ('TASK_STARTED','TASK_PAUSED','TASK_RESUMED','TASK_COMPLETED','RESULT_RECORDED','DOWNTIME_STARTED','DOWNTIME_ENDED','MAINTENANCE_STARTED','MAINTENANCE_COMPLETED')),
  occurred_at timestamptz not null,
  actor_id text not null,
  payload jsonb not null default '{}'::jsonb
);

create table if not exists integration_messages (
  id bigserial primary key,
  direction text not null check (direction in ('INBOUND','OUTBOUND')),
  message_type text not null check (message_type in ('PLAN_PUBLISHED','IMPORT_RECEIPT','ACTUAL_FEEDBACK')),
  idempotency_key text not null unique,
  received_at timestamptz not null default now(),
  accepted boolean not null,
  message text,
  payload jsonb
);

create table if not exists audit_log (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_id text not null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_state jsonb,
  after_state jsonb
);

create index if not exists idx_orders_plan on production_orders(plan_id);
create index if not exists idx_orders_due on production_orders(due_at);
create index if not exists idx_tasks_order on production_tasks(order_id);
create index if not exists idx_tasks_interval on production_tasks(planned_start, planned_end);
create index if not exists idx_task_events on production_events(task_id, occurred_at);
create index if not exists idx_results_task on production_results(task_id, recorded_at);
create index if not exists idx_downtime_equipment on downtime_events(equipment_id, started_at);
create index if not exists idx_blocks_equipment on equipment_blocks(equipment_id, start_at, end_at);
create index if not exists idx_maintenance_equipment on maintenance_orders(equipment_id, planned_start, planned_end);

-- Execution history is append-only. Corrections must be represented by a new corrective event/result.
create or replace function prevent_append_only_mutation() returns trigger as $$
begin
  raise exception 'Append-only entity % cannot be updated or deleted; create a corrective record instead', TG_TABLE_NAME;
end;
$$ language plpgsql;

drop trigger if exists production_events_append_only on production_events;
create trigger production_events_append_only
before update or delete on production_events
for each row execute function prevent_append_only_mutation();

drop trigger if exists production_results_append_only on production_results;
create trigger production_results_append_only
before update or delete on production_results
for each row execute function prevent_append_only_mutation();

drop trigger if exists audit_log_append_only on audit_log;
create trigger audit_log_append_only
before update or delete on audit_log
for each row execute function prevent_append_only_mutation();
