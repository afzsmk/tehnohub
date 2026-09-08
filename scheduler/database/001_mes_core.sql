-- scheduler/database/001_mes_core.sql
-- MES operational core. PostgreSQL / Supabase.
-- This migration is intentionally independent from Workforce tables.

create extension if not exists pgcrypto;

create table if not exists mes_operational_plans (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  version integer not null check (version > 0),
  status text not null check (status in ('DRAFT','RELEASED','EXECUTING','CLOSED','CANCELLED')),
  horizon_start date not null,
  horizon_end date not null,
  source_system text not null default 'workforce',
  source_plan_id text,
  source_plan_version integer,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  closed_at timestamptz,
  check (horizon_end >= horizon_start),
  unique (source_plan_id, source_plan_version)
);

create table if not exists mes_employees (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  display_name text not null,
  profession_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists mes_equipment (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null,
  profession_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists mes_production_orders (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  operational_plan_id uuid not null references mes_operational_plans(id),
  product_external_id text not null,
  product_name text not null,
  quantity numeric(18,6) not null check (quantity >= 0),
  unit text not null,
  due_date date not null,
  priority text not null check (priority in ('URGENT','NORMAL','LOW')) default 'NORMAL',
  status text not null check (status in ('IMPORTED','PLANNED','RELEASED','IN_EXECUTION','PARTIALLY_COMPLETED','COMPLETED','CANCELLED','BLOCKED')) default 'IMPORTED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mes_production_tasks (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  production_order_id uuid not null references mes_production_orders(id),
  operation_no integer not null,
  profession_id text not null,
  equipment_id uuid references mes_equipment(id),
  quantity numeric(18,6) not null check (quantity >= 0),
  planned_hours numeric(18,6) not null check (planned_hours > 0),
  planned_start timestamptz not null,
  planned_end timestamptz not null,
  actual_start timestamptz,
  actual_end timestamptz,
  completed_quantity numeric(18,6) not null default 0 check (completed_quantity >= 0),
  status text not null check (status in ('DRAFT','PLANNED','ASSIGNED','READY','RUNNING','PAUSED','BLOCKED','PARTIALLY_COMPLETED','COMPLETED','CANCELLED')) default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (planned_end > planned_start),
  check (actual_end is null or actual_start is null or actual_end >= actual_start),
  check (completed_quantity <= quantity)
);

create table if not exists mes_task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references mes_production_tasks(id),
  employee_id uuid not null references mes_employees(id),
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  unique (task_id, employee_id, assigned_at),
  check (released_at is null or released_at >= assigned_at)
);

create table if not exists mes_production_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references mes_production_tasks(id),
  event_type text not null,
  occurred_at timestamptz not null default now(),
  actor_id uuid references mes_employees(id),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists mes_production_results (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references mes_production_tasks(id),
  reported_at timestamptz not null default now(),
  quantity numeric(18,6) not null check (quantity >= 0),
  accepted_quantity numeric(18,6) not null check (accepted_quantity >= 0),
  scrap_quantity numeric(18,6) not null check (scrap_quantity >= 0),
  actor_id uuid references mes_employees(id)
);

create table if not exists mes_scrap_records (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references mes_production_tasks(id),
  reason_code text not null,
  quantity numeric(18,6) not null check (quantity > 0),
  recorded_at timestamptz not null default now(),
  actor_id uuid references mes_employees(id)
);

create table if not exists mes_downtime_reasons (
  code text primary key,
  name text not null,
  category text not null,
  active boolean not null default true
);

create table if not exists mes_downtime_events (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references mes_equipment(id),
  reason_code text not null references mes_downtime_reasons(code),
  started_at timestamptz not null,
  ended_at timestamptz,
  minutes integer,
  comment text,
  actor_id uuid references mes_employees(id),
  check (ended_at is null or ended_at >= started_at),
  check (minutes is null or minutes >= 0)
);

create table if not exists mes_maintenance_orders (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references mes_equipment(id),
  type text not null check (type in ('PPR','REPAIR','INSPECTION')),
  status text not null check (status in ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')) default 'PLANNED',
  planned_start timestamptz not null,
  planned_end timestamptz not null,
  actual_start timestamptz,
  actual_end timestamptz,
  comment text,
  check (planned_end > planned_start),
  check (actual_end is null or actual_start is null or actual_end >= actual_start)
);

create table if not exists mes_quality_checks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references mes_production_tasks(id),
  accepted_quantity numeric(18,6) not null check (accepted_quantity >= 0),
  rejected_quantity numeric(18,6) not null check (rejected_quantity >= 0),
  defect_code text,
  checked_at timestamptz not null default now(),
  inspector_id uuid references mes_employees(id)
);

create table if not exists mes_quality_defects (
  code text primary key,
  name text not null,
  active boolean not null default true
);

create table if not exists mes_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid references mes_employees(id),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_data jsonb,
  after_data jsonb
);

create table if not exists mes_integration_messages (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  idempotency_key text not null unique,
  message_type text not null,
  status text not null check (status in ('PENDING','RECEIVED','ACCEPTED','REJECTED','FAILED')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload jsonb not null,
  error jsonb
);

create index if not exists idx_mes_tasks_order on mes_production_tasks(production_order_id);
create index if not exists idx_mes_tasks_window on mes_production_tasks(planned_start, planned_end);
create index if not exists idx_mes_task_assignments_employee on mes_task_assignments(employee_id, assigned_at);
create index if not exists idx_mes_events_task_time on mes_production_events(task_id, occurred_at);
create index if not exists idx_mes_downtime_equipment_time on mes_downtime_events(equipment_id, started_at);
create index if not exists idx_mes_maintenance_equipment_time on mes_maintenance_orders(equipment_id, planned_start);

-- RLS is enabled now so future application policies are explicit instead of implicit.
alter table mes_operational_plans enable row level security;
alter table mes_employees enable row level security;
alter table mes_equipment enable row level security;
alter table mes_production_orders enable row level security;
alter table mes_production_tasks enable row level security;
alter table mes_task_assignments enable row level security;
alter table mes_production_events enable row level security;
alter table mes_production_results enable row level security;
alter table mes_scrap_records enable row level security;
alter table mes_downtime_reasons enable row level security;
alter table mes_downtime_events enable row level security;
alter table mes_maintenance_orders enable row level security;
alter table mes_quality_checks enable row level security;
alter table mes_quality_defects enable row level security;
alter table mes_audit_log enable row level security;
alter table mes_integration_messages enable row level security;

-- No permissive policies are created by this migration: access must be granted by role-specific policies.
