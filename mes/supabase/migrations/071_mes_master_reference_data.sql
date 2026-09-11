-- MES master-data reference entities aligned with the v1.0/v1.1 specification.
-- Existing denormalized employee fields remain for compatibility; the reference tables become the authoritative NСИ layer for new imports/UI.

create table if not exists professions (
  id text primary key,
  external_id text unique,
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true
);

create table if not exists qualification_levels (
  id text primary key,
  external_id text unique,
  code text not null unique,
  name text not null,
  level integer not null check (level >= 0),
  description text,
  active boolean not null default true
);

create table if not exists brigades (
  id text primary key,
  external_id text unique,
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true
);

create table if not exists employee_qualifications (
  id bigserial primary key,
  employee_id text not null references employees(id) on delete cascade,
  qualification_id text not null references qualification_levels(id),
  valid_from date,
  valid_to date,
  is_primary boolean not null default false,
  notes text,
  unique(employee_id, qualification_id, valid_from)
);

create index if not exists idx_employee_qualifications_employee on employee_qualifications(employee_id);
create index if not exists idx_employee_qualifications_qualification on employee_qualifications(qualification_id);

create table if not exists downtime_reasons (
  code text primary key,
  name text not null,
  category text not null,
  is_planned boolean not null default false,
  description text,
  active boolean not null default true
);

create table if not exists scrap_reasons (
  code text primary key,
  name text not null,
  category text not null,
  description text,
  active boolean not null default true
);

alter table employees add column if not exists profession_id text references professions(id);
alter table employees add column if not exists brigade_id text references brigades(id);
alter table employees add column if not exists qualification_id text references qualification_levels(id);

comment on table professions is 'MES NСИ: profession reference';
comment on table qualification_levels is 'MES NСИ: qualification reference';
comment on table brigades is 'MES NСИ: brigade reference';
comment on table employee_qualifications is 'MES NСИ: employee qualification history';
comment on table downtime_reasons is 'MES NСИ: downtime taxonomy';
comment on table scrap_reasons is 'MES NСИ: scrap taxonomy';
