-- Master-data reference tables are readable by authenticated MES users but writable only through controlled server-side RPCs.

alter table professions enable row level security;
alter table qualification_levels enable row level security;
alter table brigades enable row level security;
alter table employee_qualifications enable row level security;
alter table downtime_reasons enable row level security;
alter table scrap_reasons enable row level security;

drop policy if exists professions_select_authenticated on professions;
create policy professions_select_authenticated on professions for select to authenticated using (true);
drop policy if exists qualification_levels_select_authenticated on qualification_levels;
create policy qualification_levels_select_authenticated on qualification_levels for select to authenticated using (true);
drop policy if exists brigades_select_authenticated on brigades;
create policy brigades_select_authenticated on brigades for select to authenticated using (true);
drop policy if exists employee_qualifications_select_authenticated on employee_qualifications;
create policy employee_qualifications_select_authenticated on employee_qualifications for select to authenticated using (true);
drop policy if exists downtime_reasons_select_authenticated on downtime_reasons;
create policy downtime_reasons_select_authenticated on downtime_reasons for select to authenticated using (true);
drop policy if exists scrap_reasons_select_authenticated on scrap_reasons;
create policy scrap_reasons_select_authenticated on scrap_reasons for select to authenticated using (true);

revoke insert, update, delete on professions from authenticated;
revoke insert, update, delete on qualification_levels from authenticated;
revoke insert, update, delete on brigades from authenticated;
revoke insert, update, delete on employee_qualifications from authenticated;
revoke insert, update, delete on downtime_reasons from authenticated;
revoke insert, update, delete on scrap_reasons from authenticated;
