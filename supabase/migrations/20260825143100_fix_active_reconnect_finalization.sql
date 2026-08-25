-- Finalize a verified reconnect atomically for an existing active or disabled connection.

create or replace function public.finalize_admin_pending_integration_onboarding(
  p_organization_id text,
  p_actor_membership_id uuid,
  p_pending_authorization_id uuid,
  p_store_name text
)
returns table (outcome text, store_id uuid, connection_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_role text;
  pending_provider text;
  pending_purpose text;
  pending_external_account_id text;
  pending_encrypted_access_token text;
  pending_encrypted_refresh_token text;
  pending_access_token_expires_at timestamptz;
  pending_key_version smallint;
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
  if btrim(p_store_name) = '' then
    raise exception 'invalid onboarding input';
  end if;

  select provider, purpose, external_account_id, encrypted_access_token,
    encrypted_refresh_token, access_token_expires_at, key_version
  into pending_provider, pending_purpose, pending_external_account_id,
    pending_encrypted_access_token, pending_encrypted_refresh_token,
    pending_access_token_expires_at, pending_key_version
  from public.oauth_pending_authorizations
  where id = p_pending_authorization_id
    and organization_id = p_organization_id
    and actor_membership_id = p_actor_membership_id
    and consumed_at is null
    and expires_at > now()
  for update;

  if pending_provider is null
    or pending_purpose not in ('admin_connect', 'reconnect')
    or btrim(pending_external_account_id) = ''
    or btrim(pending_encrypted_access_token) = ''
    or pending_encrypted_refresh_token is null
    or btrim(pending_encrypted_refresh_token) = '' then
    raise exception 'pending authorization is not active for this admin context';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(pending_provider || ':' || pending_external_account_id, 0));

  select c.id, c.organization_id, c.store_id, c.status
  into existing_connection_id, existing_connection_organization_id,
    existing_connection_store_id, existing_connection_status
  from public.connections as c
  where c.provider = pending_provider and c.external_account_id = pending_external_account_id;

  if existing_connection_id is not null then
    if existing_connection_organization_id <> p_organization_id then
      raise exception 'pending authorization conflicts with an existing connection';
    end if;

    if pending_purpose = 'reconnect' then
      update public.connections
      set status = 'active', updated_at = now()
      where id = existing_connection_id and organization_id = p_organization_id;

      insert into public.integration_secrets (
        connection_id, organization_id, encrypted_access_token,
        encrypted_refresh_token, access_token_expires_at, token_metadata, key_version
      ) values (
        existing_connection_id, p_organization_id, pending_encrypted_access_token,
        pending_encrypted_refresh_token, pending_access_token_expires_at,
        '{}'::jsonb, pending_key_version
      ) on conflict on constraint integration_secrets_pkey do update set
        encrypted_access_token = excluded.encrypted_access_token,
        encrypted_refresh_token = excluded.encrypted_refresh_token,
        access_token_expires_at = excluded.access_token_expires_at,
        token_metadata = excluded.token_metadata,
        key_version = excluded.key_version,
        updated_at = now();

      insert into public.audit_events (
        organization_id, store_id, actor_membership_id, action, resource_type, resource_id, metadata
      ) values (
        p_organization_id, existing_connection_store_id, p_actor_membership_id,
        'integration.reconnected', 'connection', existing_connection_id::text,
        jsonb_build_object('provider', pending_provider, 'connectionId', existing_connection_id::text, 'storeId', existing_connection_store_id::text)
      );

      update public.oauth_pending_authorizations
      set consumed_at = now()
      where id = p_pending_authorization_id;

      return query select 'reconnected'::text, existing_connection_store_id, existing_connection_id;
      return;
    end if;

    if existing_connection_status = 'active' then
      return query select 'already_connected'::text, existing_connection_store_id, existing_connection_id;
      return;
    end if;

    update public.connections
    set status = 'active', updated_at = now()
    where id = existing_connection_id;

    insert into public.integration_secrets (
      connection_id, organization_id, encrypted_access_token,
      encrypted_refresh_token, access_token_expires_at, token_metadata, key_version
    ) values (
      existing_connection_id, p_organization_id, pending_encrypted_access_token,
      pending_encrypted_refresh_token, pending_access_token_expires_at,
      '{}'::jsonb, pending_key_version
    ) on conflict on constraint integration_secrets_pkey do update set
      encrypted_access_token = excluded.encrypted_access_token,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      access_token_expires_at = excluded.access_token_expires_at,
      token_metadata = excluded.token_metadata,
      key_version = excluded.key_version,
      updated_at = now();

    insert into public.audit_events (
      organization_id, store_id, actor_membership_id, action, resource_type, resource_id, metadata
    ) values (
      p_organization_id, existing_connection_store_id, p_actor_membership_id,
      'integration.reconnected', 'connection', existing_connection_id::text,
      jsonb_build_object('provider', pending_provider, 'connectionId', existing_connection_id::text, 'storeId', existing_connection_store_id::text)
    );

    update public.oauth_pending_authorizations set consumed_at = now() where id = p_pending_authorization_id;
    return query select 'reactivated'::text, existing_connection_store_id, existing_connection_id;
    return;
  end if;

  insert into public.stores (organization_id, name, status)
  values (p_organization_id, btrim(p_store_name), 'active') returning id into new_store_id;
  insert into public.connections (organization_id, store_id, provider, external_account_id, status)
  values (p_organization_id, new_store_id, pending_provider, pending_external_account_id, 'active') returning id into new_connection_id;
  insert into public.integration_secrets (connection_id, organization_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, token_metadata, key_version)
  values (new_connection_id, p_organization_id, pending_encrypted_access_token, pending_encrypted_refresh_token, pending_access_token_expires_at, '{}'::jsonb, pending_key_version);
  insert into public.audit_events (organization_id, store_id, actor_membership_id, action, resource_type, resource_id, metadata)
  values
    (p_organization_id, new_store_id, p_actor_membership_id, 'store.created', 'store', new_store_id::text, '{}'::jsonb),
    (p_organization_id, new_store_id, p_actor_membership_id, 'integration.connected', 'connection', new_connection_id::text, jsonb_build_object('provider', pending_provider, 'connectionId', new_connection_id::text, 'storeId', new_store_id::text));
  update public.oauth_pending_authorizations set consumed_at = now() where id = p_pending_authorization_id;
  return query select 'created'::text, new_store_id, new_connection_id;
end;
$$;

revoke all on function public.finalize_admin_pending_integration_onboarding(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_admin_pending_integration_onboarding(text, uuid, uuid, text) to service_role;
