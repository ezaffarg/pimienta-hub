-- Server-only database boundary. Browser-facing Supabase access is intentionally denied.

alter table public.oauth_attempts enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.audit_events enable row level security;

-- Phase 2 repositories use the server-only service_role client. Enabling RLS for
-- the core tables keeps the same boundary fail-closed for browser API roles.
alter table public.hub_memberships enable row level security;
alter table public.stores enable row level security;
alter table public.store_assignments enable row level security;
alter table public.connections enable row level security;

revoke all on table public.oauth_attempts from public, anon, authenticated;
revoke all on table public.integration_secrets from public, anon, authenticated;
revoke all on table public.audit_events from public, anon, authenticated;
revoke all on table public.hub_memberships from public, anon, authenticated;
revoke all on table public.stores from public, anon, authenticated;
revoke all on table public.store_assignments from public, anon, authenticated;
revoke all on table public.connections from public, anon, authenticated;

grant select, insert, update, delete on table public.oauth_attempts to service_role;
grant select, insert, update, delete on table public.integration_secrets to service_role;
grant select, insert, update, delete on table public.audit_events to service_role;
grant select, insert, update, delete on table public.hub_memberships to service_role;
grant select, insert, update, delete on table public.stores to service_role;
grant select, insert, update, delete on table public.store_assignments to service_role;
grant select, insert, update, delete on table public.connections to service_role;

revoke all on function public.bootstrap_first_owner(text, text) from public, anon, authenticated;
revoke all on function public.create_admin_integration_onboarding(text, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.create_client_integration_onboarding(text, uuid, uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.bootstrap_first_owner(text, text) to service_role;
grant execute on function public.create_admin_integration_onboarding(text, uuid, text, text, text)
  to service_role;
grant execute on function public.create_client_integration_onboarding(text, uuid, uuid, text, text, text)
  to service_role;

-- All referenced tables are schema-qualified; retain only pg_catalog in the
-- SECURITY DEFINER search path so caller-controlled objects cannot shadow them.
alter function public.bootstrap_first_owner(text, text) set search_path = pg_catalog;
alter function public.create_admin_integration_onboarding(text, uuid, text, text, text)
  set search_path = pg_catalog;
alter function public.create_client_integration_onboarding(text, uuid, uuid, text, text, text)
  set search_path = pg_catalog;
