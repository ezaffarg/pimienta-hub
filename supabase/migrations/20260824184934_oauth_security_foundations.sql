-- OAuth and onboarding foundations. This migration never stores plaintext tokens.

drop index public.connections_active_provider_account_key;

create unique index connections_provider_external_account_key
  on public.connections (provider, external_account_id)
  where external_account_id is not null;

alter table public.connections
  add constraint connections_id_organization_key unique (id, organization_id);

create table public.oauth_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  actor_membership_id uuid not null,
  provider text not null check (provider in ('mercado-libre', 'shopify', 'tiendanube', 'woocommerce')),
  purpose text not null check (purpose in ('admin_connect', 'client_self_onboard', 'reconnect')),
  state_digest text not null unique check (state_digest ~ '^[0-9a-f]{64}$'),
  encrypted_code_verifier text,
  key_version smallint not null default 1 check (key_version > 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint oauth_attempts_actor_organization_fkey
    foreign key (actor_membership_id, organization_id)
    references public.hub_memberships (id, organization_id)
    on delete restrict,
  constraint oauth_attempts_expiry_check check (expires_at > created_at)
);

create index oauth_attempts_organization_actor_idx
  on public.oauth_attempts (organization_id, actor_membership_id, expires_at);

create table public.integration_secrets (
  connection_id uuid primary key,
  organization_id text not null,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  access_token_expires_at timestamptz not null,
  token_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(token_metadata) = 'object' and octet_length(token_metadata::text) <= 4096),
  key_version smallint not null default 1 check (key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_secrets_connection_organization_fkey
    foreign key (connection_id, organization_id)
    references public.connections (id, organization_id)
    on delete restrict
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  store_id uuid,
  actor_membership_id uuid not null,
  action text not null check (action ~ '^[a-z]+(\.[a-z_]+)+$'),
  resource_type text not null check (btrim(resource_type) <> ''),
  resource_id text,
  metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(metadata) = 'object'
      and octet_length(metadata::text) <= 8192
      and not (metadata ?| array[
        'access_token', 'refresh_token', 'authorization_code', 'code', 'password', 'cookie', 'set-cookie', 'authorization'
      ])
    ),
  created_at timestamptz not null default now(),
  constraint audit_events_actor_organization_fkey
    foreign key (actor_membership_id, organization_id)
    references public.hub_memberships (id, organization_id)
    on delete restrict,
  constraint audit_events_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict
);

create index audit_events_organization_created_idx
  on public.audit_events (organization_id, created_at desc);

create index audit_events_store_created_idx
  on public.audit_events (organization_id, store_id, created_at desc)
  where store_id is not null;

create function public.create_admin_integration_onboarding(
  p_organization_id text,
  p_actor_membership_id uuid,
  p_store_name text,
  p_provider text,
  p_external_account_id text
)
returns table (outcome text, store_id uuid, connection_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  existing_connection_id uuid;
  existing_connection_organization_id text;
  existing_connection_store_id uuid;
  existing_connection_status text;
  new_store_id uuid;
  new_connection_id uuid;
begin
  select role into actor_role
  from public.hub_memberships
  where id = p_actor_membership_id and organization_id = p_organization_id;

  if actor_role is null or actor_role not in ('Owner', 'Manager') then
    raise exception 'admin onboarding actor is not authorized';
  end if;

  if btrim(p_store_name) = '' or p_provider not in ('mercado-libre', 'shopify', 'tiendanube', 'woocommerce') or btrim(p_external_account_id) = '' then
    raise exception 'invalid onboarding input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_external_account_id, 0));

  select c.id, c.organization_id, c.store_id, c.status
  into existing_connection_id, existing_connection_organization_id, existing_connection_store_id, existing_connection_status
  from public.connections as c
  where c.provider = p_provider and c.external_account_id = p_external_account_id;

  if existing_connection_id is not null then
    if existing_connection_organization_id <> p_organization_id then
      return query select 'conflict'::text, null::uuid, null::uuid;
      return;
    elsif existing_connection_status = 'active' then
      return query select 'already_connected'::text, existing_connection_store_id, existing_connection_id;
      return;
    else
      update public.connections
      set status = 'active', updated_at = now()
      where id = existing_connection_id;

      insert into public.audit_events (organization_id, store_id, actor_membership_id, action, resource_type, resource_id, metadata)
      values (p_organization_id, existing_connection_store_id, p_actor_membership_id, 'integration.reconnected', 'connection', existing_connection_id::text, '{}'::jsonb);

      return query select 'reactivated'::text, existing_connection_store_id, existing_connection_id;
      return;
    end if;
  end if;

  insert into public.stores (organization_id, name, status)
  values (p_organization_id, btrim(p_store_name), 'active')
  returning id into new_store_id;

  insert into public.connections (organization_id, store_id, provider, external_account_id, status)
  values (p_organization_id, new_store_id, p_provider, p_external_account_id, 'active')
  returning id into new_connection_id;

  insert into public.audit_events (organization_id, store_id, actor_membership_id, action, resource_type, resource_id, metadata)
  values
    (p_organization_id, new_store_id, p_actor_membership_id, 'store.created', 'store', new_store_id::text, '{}'::jsonb),
    (p_organization_id, new_store_id, p_actor_membership_id, 'integration.connected', 'connection', new_connection_id::text, '{}'::jsonb);

  return query select 'created'::text, new_store_id, new_connection_id;
end;
$$;

create function public.create_client_integration_onboarding(
  p_organization_id text,
  p_actor_membership_id uuid,
  p_client_membership_id uuid,
  p_store_name text,
  p_provider text,
  p_external_account_id text
)
returns table (outcome text, store_id uuid, connection_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  client_role text;
  existing_connection_id uuid;
  existing_connection_organization_id text;
  existing_connection_store_id uuid;
  existing_connection_status text;
  new_store_id uuid;
  new_connection_id uuid;
begin
  if p_actor_membership_id <> p_client_membership_id then
    raise exception 'client onboarding actor mismatch';
  end if;

  select role into client_role
  from public.hub_memberships
  where id = p_client_membership_id and organization_id = p_organization_id;

  if client_role is distinct from 'Client' then
    raise exception 'client onboarding membership is not a Client';
  end if;

  if btrim(p_store_name) = '' or p_provider not in ('mercado-libre', 'shopify', 'tiendanube', 'woocommerce') or btrim(p_external_account_id) = '' then
    raise exception 'invalid onboarding input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_external_account_id, 0));

  select c.id, c.organization_id, c.store_id, c.status
  into existing_connection_id, existing_connection_organization_id, existing_connection_store_id, existing_connection_status
  from public.connections as c
  where c.provider = p_provider and c.external_account_id = p_external_account_id;

  if existing_connection_id is not null then
    if existing_connection_organization_id <> p_organization_id then
      return query select 'conflict'::text, null::uuid, null::uuid;
      return;
    elsif existing_connection_status = 'active' then
      return query select 'already_connected'::text, existing_connection_store_id, existing_connection_id;
      return;
    else
      update public.connections
      set status = 'active', updated_at = now()
      where id = existing_connection_id;

      insert into public.store_assignments (membership_id, store_id, organization_id)
      values (p_client_membership_id, existing_connection_store_id, p_organization_id)
      on conflict (membership_id, store_id) do nothing;

      insert into public.audit_events (organization_id, store_id, actor_membership_id, action, resource_type, resource_id, metadata)
      values (p_organization_id, existing_connection_store_id, p_actor_membership_id, 'integration.reconnected', 'connection', existing_connection_id::text, '{}'::jsonb);

      return query select 'reactivated'::text, existing_connection_store_id, existing_connection_id;
      return;
    end if;
  end if;

  insert into public.stores (organization_id, name, status)
  values (p_organization_id, btrim(p_store_name), 'active')
  returning id into new_store_id;

  insert into public.connections (organization_id, store_id, provider, external_account_id, status)
  values (p_organization_id, new_store_id, p_provider, p_external_account_id, 'active')
  returning id into new_connection_id;

  insert into public.store_assignments (membership_id, store_id, organization_id)
  values (p_client_membership_id, new_store_id, p_organization_id);

  insert into public.audit_events (organization_id, store_id, actor_membership_id, action, resource_type, resource_id, metadata)
  values
    (p_organization_id, new_store_id, p_actor_membership_id, 'store.created', 'store', new_store_id::text, '{}'::jsonb),
    (p_organization_id, new_store_id, p_actor_membership_id, 'integration.connected', 'connection', new_connection_id::text, '{}'::jsonb),
    (p_organization_id, new_store_id, p_actor_membership_id, 'membership.assigned', 'store_assignment', new_store_id::text, '{}'::jsonb);

  return query select 'created'::text, new_store_id, new_connection_id;
end;
$$;

revoke all on function public.create_admin_integration_onboarding(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.create_client_integration_onboarding(text, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_admin_integration_onboarding(text, uuid, text, text, text) to service_role;
grant execute on function public.create_client_integration_onboarding(text, uuid, uuid, text, text, text) to service_role;
