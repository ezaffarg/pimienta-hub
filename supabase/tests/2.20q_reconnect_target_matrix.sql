\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception '2.20Q assertion failed: %', message;
  end if;
end;
$$;

create function pg_temp.make_pending(
  p_organization_id text,
  p_actor_membership_id uuid,
  p_purpose text,
  p_provider text,
  p_external_account_id text,
  p_target_connection_id uuid default null,
  p_expired boolean default false,
  p_consumed boolean default false
)
returns uuid
language plpgsql
as $$
declare
  attempt_id uuid := gen_random_uuid();
  pending_id uuid := gen_random_uuid();
  created_time timestamptz := case
    when p_expired then now() - interval '2 hours'
    else now()
  end;
  expiry_time timestamptz := case
    when p_expired then now() - interval '1 hour'
    else now() + interval '20 minutes'
  end;
begin
  insert into public.oauth_attempts (
    id, organization_id, actor_membership_id, provider, purpose,
    state_digest, expires_at, consumed_at, created_at
  ) values (
    attempt_id, p_organization_id, p_actor_membership_id, p_provider, p_purpose,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    expiry_time, now(), created_time
  );

  insert into public.oauth_pending_authorizations (
    id, oauth_attempt_id, organization_id, actor_membership_id, provider,
    purpose, target_connection_id, external_account_id, display_name,
    encrypted_access_token, encrypted_refresh_token,
    access_token_expires_at, key_version, expires_at, consumed_at, created_at
  ) values (
    pending_id, attempt_id, p_organization_id, p_actor_membership_id, p_provider,
    p_purpose, p_target_connection_id, p_external_account_id, 'Fixture 2.20Q',
    'new-access-' || pending_id::text, 'new-refresh-' || pending_id::text,
    now() + interval '6 hours', 1, expiry_time,
    case when p_consumed then now() else null end, created_time
  );

  return pending_id;
end;
$$;

insert into public.hub_memberships (id, organization_id, clerk_user_id, role)
values
  ('20000000-0000-4000-8000-000000000001', 'org_220q_a', 'user_220q_a', 'Owner'),
  ('20000000-0000-4000-8000-000000000002', 'org_220q_b', 'user_220q_b', 'Owner');

insert into public.stores (id, organization_id, name, status)
values
  ('20000000-0000-4000-8000-000000000101', 'org_220q_a', 'Fixture 2.20Q A', 'active'),
  ('20000000-0000-4000-8000-000000000102', 'org_220q_b', 'Fixture 2.20Q B', 'active');

insert into public.connections (
  id, organization_id, store_id, provider, external_account_id, status
)
values
  ('20000000-0000-4000-8000-000000000201', 'org_220q_a', '20000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-active', 'active'),
  ('20000000-0000-4000-8000-000000000202', 'org_220q_a', '20000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-disabled', 'disabled'),
  ('20000000-0000-4000-8000-000000000203', 'org_220q_b', '20000000-0000-4000-8000-000000000102', 'mercado-libre', 'account-cross-tenant', 'active'),
  ('20000000-0000-4000-8000-000000000204', 'org_220q_a', '20000000-0000-4000-8000-000000000101', 'shopify', 'account-provider-mismatch', 'active'),
  ('20000000-0000-4000-8000-000000000205', 'org_220q_a', '20000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-target-identity', 'active'),
  ('20000000-0000-4000-8000-000000000206', 'org_220q_a', '20000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-rollback', 'disabled');

insert into public.integration_secrets (
  connection_id, organization_id, encrypted_access_token,
  encrypted_refresh_token, access_token_expires_at, key_version,
  credential_version, refresh_lease_id, refresh_lease_expires_at
)
values
  ('20000000-0000-4000-8000-000000000201', 'org_220q_a', 'old-access-active', 'old-refresh-active', now() + interval '1 hour', 1, 7, '20000000-0000-4000-8000-000000000301', now() + interval '1 minute'),
  ('20000000-0000-4000-8000-000000000202', 'org_220q_a', 'old-access-disabled', 'old-refresh-disabled', now() + interval '1 hour', 1, 3, null, null),
  ('20000000-0000-4000-8000-000000000206', 'org_220q_a', 'old-access-rollback', 'old-refresh-rollback', now() + interval '1 hour', 1, 11, '20000000-0000-4000-8000-000000000306', now() + interval '1 minute');

create temp table matrix_baseline as
select
  (select count(*) from public.stores) as store_count,
  (select count(*) from public.connections) as connection_count,
  (select count(*) from public.integration_secrets) as secret_count;

-- A. Normal connect keeps active-existing behavior and never reports reconnect.
do $$
declare
  pending_id uuid;
  result record;
begin
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'admin_connect', 'mercado-libre', 'account-active'
  );
  select * into result
  from public.finalize_admin_pending_integration_onboarding(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    pending_id, 'Unused connect name'
  );
  perform pg_temp.assert_true(result.outcome = 'already_connected', 'A outcome');
  perform pg_temp.assert_true(result.outcome <> 'reconnected', 'A not reconnect');
end;
$$;
\echo 'A CONNECT + active existing: PASS'

-- B. Active reconnect reuses identifiers, rotates once, clears lease, audits, and consumes.
do $$
declare
  pending_id uuid;
  result record;
begin
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'reconnect', 'mercado-libre', 'account-active',
    '20000000-0000-4000-8000-000000000201'
  );
  select * into result
  from public.finalize_admin_pending_integration_onboarding(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    pending_id, 'Unused reconnect name'
  );
  perform pg_temp.assert_true(result.outcome = 'reconnected', 'B outcome');
  perform pg_temp.assert_true(result.store_id = '20000000-0000-4000-8000-000000000101', 'B same Store');
  perform pg_temp.assert_true(result.connection_id = '20000000-0000-4000-8000-000000000201', 'B same Connection');
  perform pg_temp.assert_true(
    (select credential_version = 8 and refresh_lease_id is null
       and encrypted_access_token = 'new-access-' || pending_id::text
     from public.integration_secrets
     where connection_id = '20000000-0000-4000-8000-000000000201'),
    'B credential version, secret, and lease'
  );
  perform pg_temp.assert_true(
    (select consumed_at is not null from public.oauth_pending_authorizations where id = pending_id),
    'B pending consumed'
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.audit_events
     where action = 'integration.reconnected'
       and resource_id = '20000000-0000-4000-8000-000000000201'),
    'B audit'
  );
end;
$$;
\echo 'B RECONNECT + active: PASS'

-- C. Disabled reconnect reuses the target and reactivates it.
do $$
declare
  pending_id uuid;
  result record;
begin
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'reconnect', 'mercado-libre', 'account-disabled',
    '20000000-0000-4000-8000-000000000202'
  );
  select * into result
  from public.finalize_admin_pending_integration_onboarding(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    pending_id, 'Unused reconnect name'
  );
  perform pg_temp.assert_true(result.outcome = 'reconnected', 'C outcome');
  perform pg_temp.assert_true(result.store_id = '20000000-0000-4000-8000-000000000101', 'C same Store');
  perform pg_temp.assert_true(result.connection_id = '20000000-0000-4000-8000-000000000202', 'C same Connection');
  perform pg_temp.assert_true(
    (select status = 'active' from public.connections where id = result.connection_id),
    'C active status'
  );
  perform pg_temp.assert_true(
    (select credential_version = 4 from public.integration_secrets where connection_id = result.connection_id),
    'C credential version'
  );
end;
$$;
\echo 'C RECONNECT + disabled: PASS'

-- Invalid target fixtures exercise the RPC fail-closed path. Both DDL changes roll back.
alter table public.oauth_pending_authorizations
  drop constraint oauth_pending_authorizations_reconnect_target_check;
alter table public.oauth_pending_authorizations
  drop constraint oauth_pending_authorizations_target_connection_fkey;

-- D-H. Target binding failures preserve each pending and never create resources.
do $$
declare
  pending_id uuid;
  failed boolean;
  stores_before bigint;
  connections_before bigint;
begin
  select count(*) into stores_before from public.stores;
  select count(*) into connections_before from public.connections;
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'reconnect', 'mercado-libre', 'account-missing-null', null
  );
  failed := false;
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'org_220q_a', '20000000-0000-4000-8000-000000000001', pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'D target NULL rejected');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'D pending preserved'
  );
  perform pg_temp.assert_true((select count(*) from public.stores) = stores_before, 'D no Store');
  perform pg_temp.assert_true((select count(*) from public.connections) = connections_before, 'D no Connection');
end;
$$;
\echo 'D target NULL: PASS'

do $$
declare
  pending_id uuid;
  failed boolean;
begin
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'reconnect', 'mercado-libre', 'account-not-found',
    '20000000-0000-4000-8000-000000000299'
  );
  failed := false;
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'org_220q_a', '20000000-0000-4000-8000-000000000001', pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'E missing target rejected');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'E pending preserved'
  );
end;
$$;
\echo 'E target inexistente: PASS'

do $$
declare
  pending_id uuid;
  failed boolean;
begin
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'reconnect', 'mercado-libre', 'account-cross-tenant',
    '20000000-0000-4000-8000-000000000203'
  );
  failed := false;
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'org_220q_a', '20000000-0000-4000-8000-000000000001', pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'F cross-tenant rejected');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'F pending preserved'
  );
end;
$$;
\echo 'F target cross-tenant: PASS'

do $$
declare
  pending_id uuid;
  failed boolean;
begin
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'reconnect', 'mercado-libre', 'account-provider-mismatch',
    '20000000-0000-4000-8000-000000000204'
  );
  failed := false;
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'org_220q_a', '20000000-0000-4000-8000-000000000001', pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'G provider mismatch rejected');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'G pending preserved'
  );
end;
$$;
\echo 'G provider mismatch: PASS'

do $$
declare
  pending_id uuid;
  failed boolean;
begin
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'reconnect', 'mercado-libre', 'account-pending-identity',
    '20000000-0000-4000-8000-000000000205'
  );
  failed := false;
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'org_220q_a', '20000000-0000-4000-8000-000000000001', pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'H identity mismatch rejected');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'H pending preserved'
  );
end;
$$;
\echo 'H identity mismatch: PASS'

-- I-J. Expired and consumed pending authorizations remain unusable.
do $$
declare
  pending_id uuid;
  failed boolean;
begin
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'reconnect', 'mercado-libre', 'account-active',
    '20000000-0000-4000-8000-000000000201', true, false
  );
  failed := false;
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'org_220q_a', '20000000-0000-4000-8000-000000000001', pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'I expired pending rejected');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'I pending unchanged'
  );
end;
$$;
\echo 'I pending expirada: PASS'

do $$
declare
  pending_id uuid;
  consumed_before timestamptz;
  failed boolean;
begin
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'reconnect', 'mercado-libre', 'account-active',
    '20000000-0000-4000-8000-000000000201', false, true
  );
  select consumed_at into consumed_before
  from public.oauth_pending_authorizations where id = pending_id;
  failed := false;
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'org_220q_a', '20000000-0000-4000-8000-000000000001', pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'J consumed pending rejected');
  perform pg_temp.assert_true(
    (select consumed_at = consumed_before from public.oauth_pending_authorizations where id = pending_id),
    'J consumed timestamp unchanged'
  );
end;
$$;
\echo 'J pending consumida: PASS'

-- K. A late audit failure rolls back status, credentials, version, lease, and consumption.
create function pg_temp.fail_reconnect_audit()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'integration.reconnected' then
    raise exception 'synthetic audit failure';
  end if;
  return new;
end;
$$;

create trigger matrix_fail_reconnect_audit
before insert on public.audit_events
for each row execute function pg_temp.fail_reconnect_audit();

do $$
declare
  pending_id uuid;
  failed boolean;
begin
  pending_id := pg_temp.make_pending(
    'org_220q_a', '20000000-0000-4000-8000-000000000001',
    'reconnect', 'mercado-libre', 'account-rollback',
    '20000000-0000-4000-8000-000000000206'
  );
  failed := false;
  begin
    perform * from public.finalize_admin_pending_integration_onboarding(
      'org_220q_a', '20000000-0000-4000-8000-000000000001', pending_id, 'Unused'
    );
  exception when others then failed := true;
  end;
  perform pg_temp.assert_true(failed, 'K synthetic failure raised');
  perform pg_temp.assert_true(
    (select consumed_at is null from public.oauth_pending_authorizations where id = pending_id),
    'K pending preserved'
  );
  perform pg_temp.assert_true(
    (select status = 'disabled' from public.connections
     where id = '20000000-0000-4000-8000-000000000206'),
    'K status rolled back'
  );
  perform pg_temp.assert_true(
    (select encrypted_access_token = 'old-access-rollback'
       and encrypted_refresh_token = 'old-refresh-rollback'
       and credential_version = 11
       and refresh_lease_id = '20000000-0000-4000-8000-000000000306'
     from public.integration_secrets
     where connection_id = '20000000-0000-4000-8000-000000000206'),
    'K credentials, version, and lease rolled back'
  );
  perform pg_temp.assert_true(
    (select count(*) = 0 from public.audit_events
     where action = 'integration.reconnected'
       and resource_id = '20000000-0000-4000-8000-000000000206'),
    'K audit rolled back'
  );
end;
$$;

drop trigger matrix_fail_reconnect_audit on public.audit_events;
\echo 'K rollback por error: PASS'

-- L-M and duplicate checks: reconnect paths never changed resource cardinality.
select pg_temp.assert_true(
  (select count(*) from public.stores) = (select store_count from matrix_baseline),
  'L reconnect never creates Store'
);
\echo 'L reconnect nunca crea Store: PASS'

select pg_temp.assert_true(
  (select count(*) from public.connections) = (select connection_count from matrix_baseline),
  'M reconnect never creates Connection'
);
\echo 'M reconnect nunca crea Connection: PASS'

select pg_temp.assert_true(
  (select count(*) from public.integration_secrets) = (select secret_count from matrix_baseline),
  'integration secret count stable'
);

select pg_temp.assert_true(
  not exists (
    select organization_id, name
    from public.stores
    where organization_id like 'org_220q_%'
    group by organization_id, name
    having count(*) > 1
  ),
  'Store duplicates'
);

select pg_temp.assert_true(
  not exists (
    select provider, external_account_id
    from public.connections
    where organization_id like 'org_220q_%'
    group by provider, external_account_id
    having count(*) > 1
  ),
  'Connection duplicates'
);

\echo 'MATRIX 13/13 PASS'
\echo 'Store duplicates = 0'
\echo 'Connection duplicates = 0'

rollback;

select
  (
    (select count(*) from public.hub_memberships where organization_id like 'org_220q_%')
    + (select count(*) from public.stores where organization_id like 'org_220q_%')
    + (select count(*) from public.connections where organization_id like 'org_220q_%')
    + (select count(*) from public.oauth_attempts where organization_id like 'org_220q_%')
    + (select count(*) from public.oauth_pending_authorizations where organization_id like 'org_220q_%')
    + (select count(*) from public.integration_secrets where organization_id like 'org_220q_%')
    + (select count(*) from public.audit_events where organization_id like 'org_220q_%')
  ) as persisted_fixture_rows;
