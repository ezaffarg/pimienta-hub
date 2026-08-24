-- Server-only staging for a verified OAuth identity before onboarding creates a Connection.

alter table public.oauth_attempts
  add constraint oauth_attempts_pending_binding_key
  unique (id, organization_id, actor_membership_id, provider, purpose);

create table public.oauth_pending_authorizations (
  id uuid primary key default gen_random_uuid(),
  oauth_attempt_id uuid not null unique,
  organization_id text not null,
  actor_membership_id uuid not null,
  provider text not null check (provider in ('mercado-libre', 'shopify', 'tiendanube', 'woocommerce')),
  purpose text not null check (purpose in ('admin_connect', 'client_self_onboard', 'reconnect')),
  external_account_id text not null check (btrim(external_account_id) <> ''),
  display_name text check (display_name is null or btrim(display_name) <> ''),
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz not null,
  key_version smallint not null default 1 check (key_version > 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint oauth_pending_authorizations_attempt_binding_fkey
    foreign key (oauth_attempt_id, organization_id, actor_membership_id, provider, purpose)
    references public.oauth_attempts (id, organization_id, actor_membership_id, provider, purpose)
    on delete restrict,
  constraint oauth_pending_authorizations_expiry_check check (expires_at > created_at)
);

create index oauth_pending_authorizations_actor_idx
  on public.oauth_pending_authorizations (organization_id, actor_membership_id, provider, purpose, expires_at)
  where consumed_at is null;

alter table public.oauth_pending_authorizations enable row level security;
revoke all on table public.oauth_pending_authorizations from public, anon, authenticated;
grant select, insert, update, delete on table public.oauth_pending_authorizations to service_role;
