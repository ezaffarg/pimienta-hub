-- Coordinate single-use provider refresh tokens without holding a database lock during HTTP.

alter table public.integration_secrets
  add column credential_version bigint not null default 1 check (credential_version > 0),
  add column refresh_lease_id uuid,
  add column refresh_lease_expires_at timestamptz;

create function public.advance_integration_secret_version()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.encrypted_access_token is distinct from old.encrypted_access_token
     or new.encrypted_refresh_token is distinct from old.encrypted_refresh_token
     or new.access_token_expires_at is distinct from old.access_token_expires_at
     or new.token_metadata is distinct from old.token_metadata
     or new.key_version is distinct from old.key_version then
    new.credential_version := old.credential_version + 1;
    new.refresh_lease_id := null;
    new.refresh_lease_expires_at := null;
  end if;

  return new;
end;
$$;

create trigger integration_secrets_credential_version_trigger
before update on public.integration_secrets
for each row execute function public.advance_integration_secret_version();

create function public.claim_integration_secret_refresh(
  p_organization_id text,
  p_connection_id uuid,
  p_expected_version bigint,
  p_refresh_before timestamptz,
  p_lease_id uuid
)
returns table(outcome text, credential_version bigint)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_secret public.integration_secrets%rowtype;
begin
  select *
    into current_secret
    from public.integration_secrets
    where organization_id = p_organization_id
      and connection_id = p_connection_id
    for update;

  if not found then
    return query select 'not_found'::text, null::bigint;
    return;
  end if;

  if current_secret.credential_version <> p_expected_version
     or current_secret.access_token_expires_at > p_refresh_before then
    return query select 'already_refreshed'::text, current_secret.credential_version;
    return;
  end if;

  if current_secret.refresh_lease_expires_at is not null
     and current_secret.refresh_lease_expires_at > now() then
    return query select 'busy'::text, current_secret.credential_version;
    return;
  end if;

  update public.integration_secrets
    set refresh_lease_id = p_lease_id,
        refresh_lease_expires_at = now() + interval '60 seconds',
        updated_at = now()
    where connection_id = p_connection_id
      and organization_id = p_organization_id;

  return query select 'claimed'::text, current_secret.credential_version;
end;
$$;

create function public.complete_integration_secret_refresh(
  p_organization_id text,
  p_connection_id uuid,
  p_expected_version bigint,
  p_lease_id uuid,
  p_encrypted_access_token text,
  p_encrypted_refresh_token text,
  p_access_token_expires_at timestamptz,
  p_token_metadata jsonb,
  p_key_version smallint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  updated_count integer;
begin
  update public.integration_secrets
    set encrypted_access_token = p_encrypted_access_token,
        encrypted_refresh_token = p_encrypted_refresh_token,
        access_token_expires_at = p_access_token_expires_at,
        token_metadata = p_token_metadata,
        key_version = p_key_version,
        credential_version = credential_version + 1,
        refresh_lease_id = null,
        refresh_lease_expires_at = null,
        updated_at = now()
    where organization_id = p_organization_id
      and connection_id = p_connection_id
      and credential_version = p_expected_version
      and refresh_lease_id = p_lease_id
      and refresh_lease_expires_at > now();

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create function public.release_integration_secret_refresh(
  p_organization_id text,
  p_connection_id uuid,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  updated_count integer;
begin
  update public.integration_secrets
    set refresh_lease_id = null,
        refresh_lease_expires_at = null,
        updated_at = now()
    where organization_id = p_organization_id
      and connection_id = p_connection_id
      and refresh_lease_id = p_lease_id;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.claim_integration_secret_refresh(text, uuid, bigint, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_integration_secret_refresh(text, uuid, bigint, uuid, text, text, timestamptz, jsonb, smallint)
  from public, anon, authenticated;
revoke all on function public.release_integration_secret_refresh(text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_integration_secret_refresh(text, uuid, bigint, timestamptz, uuid)
  to service_role;
grant execute on function public.complete_integration_secret_refresh(text, uuid, bigint, uuid, text, text, timestamptz, jsonb, smallint)
  to service_role;
grant execute on function public.release_integration_secret_refresh(text, uuid, uuid)
  to service_role;

revoke all on function public.advance_integration_secret_version() from public, anon, authenticated;
