begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception 'remote 2.20Q assertion failed: %', message;
  end if;
end;
$$;

create function pg_temp.make_pending(
  p_organization_id text,
  p_actor_membership_id uuid,
  p_provider text,
  p_external_account_id text,
  p_target_connection_id uuid
)
returns uuid
language plpgsql
as $$
declare
  attempt_id uuid := gen_random_uuid();
  pending_id uuid := gen_random_uuid();
begin
  insert into public.oauth_attempts (
    id, organization_id, actor_membership_id, provider, purpose,
    state_digest, expires_at, consumed_at
  ) values (
    attempt_id, p_organization_id, p_actor_membership_id, p_provider, 'reconnect',
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    now() + interval '10 minutes', now()
  );

  insert into public.oauth_pending_authorizations (
    id, oauth_attempt_id, organization_id, actor_membership_id, provider,
    purpose, target_connection_id, external_account_id, display_name,
    encrypted_access_token, encrypted_refresh_token,
    access_token_expires_at, key_version, expires_at
  ) values (
    pending_id, attempt_id, p_organization_id, p_actor_membership_id, p_provider,
    'reconnect', p_target_connection_id, p_external_account_id,
    'Remote fixture 2.20Q', 'fixture-new-access-' || pending_id::text,
    'fixture-new-refresh-' || pending_id::text,
    now() + interval '6 hours', 1, now() + interval '20 minutes'
  );

  return pending_id;
end;
$$;

insert into public.hub_memberships (id, organization_id, clerk_user_id, role)
values
  ('22000000-0000-4000-8000-000000000001', 'remote_validation_220q_a', 'remote_validation_220q_user_a', 'Owner'),
  ('22000000-0000-4000-8000-000000000002', 'remote_validation_220q_b', 'remote_validation_220q_user_b', 'Owner');

insert into public.stores (id, organization_id, name, status)
values
  ('22000000-0000-4000-8000-000000000101', 'remote_validation_220q_a', 'Remote validation 2.20Q A', 'active'),
  ('22000000-0000-4000-8000-000000000102', 'remote_validation_220q_b', 'Remote validation 2.20Q B', 'active');

insert into public.connections (
  id, organization_id, store_id, provider, external_account_id, status
)
values
  ('22000000-0000-4000-8000-000000000201', 'remote_validation_220q_a', '22000000-0000-4000-8000-000000000101', 'mercado-libre', 'remote-validation-220q-active', 'active'),
  ('22000000-0000-4000-8000-000000000202', 'remote_validation_220q_a', '22000000-0000-4000-8000-000000000101', 'mercado-libre', 'remote-validation-220q-disabled', 'disabled'),
  ('22000000-0000-4000-8000-000000000203', 'remote_validation_220q_b', '22000000-0000-4000-8000-000000000102', 'mercado-libre', 'remote-validation-220q-cross', 'active'),
  ('22000000-0000-4000-8000-000000000204', 'remote_validation_220q_a', '22000000-0000-4000-8000-000000000101', 'shopify', 'remote-validation-220q-provider', 'active'),
  ('22000000-0000-4000-8000-000000000205', 'remote_validation_220q_a', '22000000-0000-4000-8000-000000000101', 'mercado-libre', 'remote-validation-220q-target-identity', 'active'),
  ('22000000-0000-4000-8000-000000000206', 'remote_validation_220q_a', '22000000-0000-4000-8000-000000000101', 'mercado-libre', 'remote-validation-220q-rollback', 'disabled');

insert into public.integration_secrets (
  connection_id, organization_id, encrypted_access_token,
  encrypted_refresh_token, access_token_expires_at, key_version,
  credential_version, refresh_lease_id, refresh_lease_expires_at
)
values
  ('22000000-0000-4000-8000-000000000201', 'remote_validation_220q_a', 'fixture-old-access-active', 'fixture-old-refresh-active', now() + interval '1 hour', 1, 7, '22000000-0000-4000-8000-000000000301', now() + interval '1 minute'),
  ('22000000-0000-4000-8000-000000000202', 'remote_validation_220q_a', 'fixture-old-access-disabled', 'fixture-old-refresh-disabled', now() + interval '1 hour', 1, 3, null, null),
  ('22000000-0000-4000-8000-000000000206', 'remote_validation_220q_a', 'fixture-old-access-rollback', 'fixture-old-refresh-rollback', now() + interval '1 hour', 1, 11, '22000000-0000-4000-8000-000000000306', now() + interval '1 minute');

create temp table remote_matrix_baseline as
select
  (select count(*) from public.stores) as store_count,
  (select count(*) from public.connections) as connection_count,
  (select count(*) from public.integration_secrets) as secret_count;

-- A. Active reconnect.
do $$
declare
  pending_id uuid;
  result record;
begin
  pending_id := pg_temp.make_pending(
    'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
    'mercado-libre', 'remote-validation-220q-active',
    '22000000-0000-4000-8000-000000000201'
  );
  select * into result
  from public.finalize_admin_pending_integration_onboarding(
    'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
    pending_id, 'Unused remote fixture name'
  );
  perform pg_temp.assert_true(result.outcome = 'reconnected', 'A outcome');
  perform pg_temp.assert_true(result.store_id = '22000000-0000-4000-8000-000000000101', 'A same Store');
  perform pg_temp.assert_true(result.connection_id = '22000000-0000-4000-8000-000000000201', 'A same Connection');
  perform pg_temp.assert_true(
    (select credential_version = 8 and refresh_lease_id is null
     from public.integration_secrets where connection_id = result.connection_id),
    'A version and lease'
  );
  perform pg_temp.assert_true(
    (select consumed_at is not null from public.oauth_pending_authorizations where id = pending_id),
    'A pending consumed'
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.audit_events
     where action = 'integration.reconnected' and resource_id = result.connection_id::text),
    'A audit'
  );
end;
$$;

-- B. Disabled reconnect becomes active without changing identifiers.
do $$
declare
  pending_id uuid;
  result record;
begin
  pending_id := pg_temp.make_pending(
    'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
    'mercado-libre', 'remote-validation-220q-disabled',
    '22000000-0000-4000-8000-000000000202'
  );
  select * into result
  from public.finalize_admin_pending_integration_onboarding(
    'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
    pending_id, 'Unused remote fixture name'
  );
  perform pg_temp.assert_true(result.outcome = 'reconnected', 'B outcome');
  perform pg_temp.assert_true(result.store_id = '22000000-0000-4000-8000-000000000101', 'B same Store');
  perform pg_temp.assert_true(result.connection_id = '22000000-0000-4000-8000-000000000202', 'B same Connection');
  perform pg_temp.assert_true(
    (select status = 'active' from public.connections where id = result.connection_id),
    'B active status'
  );
end;
$$;

-- C. The definitive CHECK rejects a synthetic reconnect with no target.
do $$
declare
  failed boolean := false;
begin
  begin
    perform pg_temp.make_pending(
      'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
      'mercado-libre', 'remote-validation-220q-null', null
    );
  exception when others then
    failed := true;
  end;
  perform pg_temp.assert_true(failed, 'C target NULL rejected');
end;
$$;

-- D-F. Target binding mismatches fail closed and preserve the pending.
do $$
declare
  pending_id uuid;
  failed boolean := false;
begin
  pending_id := pg_temp.make_pending(
    'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
    'mercado-libre', 'remote-validation-220q-cross',
    '22000000-0000-4000-8000-000000000203'
  );
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
      pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'D cross-tenant rejected');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'D pending preserved'
  );
end;
$$;

do $$
declare
  pending_id uuid;
  failed boolean := false;
begin
  pending_id := pg_temp.make_pending(
    'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
    'mercado-libre', 'remote-validation-220q-provider',
    '22000000-0000-4000-8000-000000000204'
  );
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
      pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'E provider mismatch rejected');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'E pending preserved'
  );
end;
$$;

do $$
declare
  pending_id uuid;
  failed boolean := false;
begin
  pending_id := pg_temp.make_pending(
    'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
    'mercado-libre', 'remote-validation-220q-pending-identity',
    '22000000-0000-4000-8000-000000000205'
  );
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
      pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'F identity mismatch rejected');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'F pending preserved'
  );
end;
$$;

-- G. A late synthetic audit failure rolls every reconnect write back.
create function pg_temp.fail_remote_reconnect_audit()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'integration.reconnected' then
    raise exception 'synthetic remote audit failure';
  end if;
  return new;
end;
$$;

create trigger remote_matrix_fail_reconnect_audit
before insert on public.audit_events
for each row execute function pg_temp.fail_remote_reconnect_audit();

do $$
declare
  pending_id uuid;
  failed boolean := false;
begin
  pending_id := pg_temp.make_pending(
    'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
    'mercado-libre', 'remote-validation-220q-rollback',
    '22000000-0000-4000-8000-000000000206'
  );
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'remote_validation_220q_a', '22000000-0000-4000-8000-000000000001',
      pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'G synthetic failure raised');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'G pending preserved'
  );
  perform pg_temp.assert_true(
    (select status = 'disabled' from public.connections
     where id = '22000000-0000-4000-8000-000000000206'),
    'G Connection status restored'
  );
  perform pg_temp.assert_true(
    (select encrypted_access_token = 'fixture-old-access-rollback'
       and encrypted_refresh_token = 'fixture-old-refresh-rollback'
       and credential_version = 11
       and refresh_lease_id = '22000000-0000-4000-8000-000000000306'
     from public.integration_secrets
     where connection_id = '22000000-0000-4000-8000-000000000206'),
    'G secret, version, and lease restored'
  );
  perform pg_temp.assert_true(
    (select count(*) = 0 from public.audit_events
     where action = 'integration.reconnected'
       and resource_id = '22000000-0000-4000-8000-000000000206'),
    'G audit restored'
  );
end;
$$;

drop trigger remote_matrix_fail_reconnect_audit on public.audit_events;

-- H. All reconnect paths preserve Store, Connection, and secret cardinality.
select pg_temp.assert_true(
  (select count(*) from public.stores) = (select store_count from remote_matrix_baseline),
  'H Store count stable'
);
select pg_temp.assert_true(
  (select count(*) from public.connections) = (select connection_count from remote_matrix_baseline),
  'H Connection count stable'
);
select pg_temp.assert_true(
  (select count(*) from public.integration_secrets) = (select secret_count from remote_matrix_baseline),
  'H secret count stable'
);

rollback;

select
  (
    (select count(*) from public.hub_memberships where organization_id like 'remote_validation_220q_%')
    + (select count(*) from public.stores where organization_id like 'remote_validation_220q_%')
    + (select count(*) from public.connections where organization_id like 'remote_validation_220q_%')
    + (select count(*) from public.oauth_attempts where organization_id like 'remote_validation_220q_%')
    + (select count(*) from public.oauth_pending_authorizations where organization_id like 'remote_validation_220q_%')
    + (select count(*) from public.integration_secrets where organization_id like 'remote_validation_220q_%')
    + (select count(*) from public.audit_events where organization_id like 'remote_validation_220q_%')
  ) as persisted_fixture_rows,
  '8/8 PASS'::text as remote_matrix;
