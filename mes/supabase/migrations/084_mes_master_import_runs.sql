-- Persistent history for controlled MES master-data imports.
-- Import execution is performed by mes_import_bootstrap() through a SECURITY DEFINER
-- RPC; browser roles may read history but never write it directly.

create table if not exists public.mes_master_import_runs (
  id text primary key,
  actor_id text,
  status text not null default 'STARTED'
    check (status in ('STARTED','COMPLETED','FAILED')),
  source_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb
);

create index if not exists idx_mes_master_import_runs_started_at
  on public.mes_master_import_runs(started_at desc);

create index if not exists idx_mes_master_import_runs_status
  on public.mes_master_import_runs(status);

alter table public.mes_master_import_runs enable row level security;

drop policy if exists mes_master_import_runs_select_authenticated
  on public.mes_master_import_runs;
create policy mes_master_import_runs_select_authenticated
  on public.mes_master_import_runs
  for select to authenticated
  using (true);

revoke insert, update, delete on public.mes_master_import_runs from anon, authenticated;

grant select on public.mes_master_import_runs to authenticated;

comment on table public.mes_master_import_runs is
  'MES master-data import execution history; writes are controlled by the server-side import RPC.';
comment on column public.mes_master_import_runs.actor_id is
  'auth.uid() value of the MES master-data editor who initiated the import.';
comment on column public.mes_master_import_runs.status is
  'STARTED, COMPLETED or FAILED lifecycle state of an import run.';
comment on column public.mes_master_import_runs.counts is
  'Per-entity import counters recorded by mes_import_bootstrap().';
comment on column public.mes_master_import_runs.errors is
  'Structured import errors retained for failed runs.';
