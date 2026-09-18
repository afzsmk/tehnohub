-- Production request tables are browser-readable only through their RLS policies.
-- RLS alone is not enough: authenticated must also have table-level SELECT privilege.
grant select on table public.production_requests, public.production_request_items to authenticated;
