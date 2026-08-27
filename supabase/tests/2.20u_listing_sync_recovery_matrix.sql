\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception '2.20U assertion failed: %', message; end if;
end;
$$;

insert into public.hub_memberships (id, organization_id, clerk_user_id, role) values
  ('40000000-0000-4000-8000-000000000001', 'org_220u_a', 'owner_220u', 'Owner'),
  ('40000000-0000-4000-8000-000000000002', 'org_220u_a', 'manager_220u', 'Manager'),
  ('40000000-0000-4000-8000-000000000003', 'org_220u_a', 'employee_220u', 'Employee'),
  ('40000000-0000-4000-8000-000000000004', 'org_220u_a', 'client_220u', 'Client'),
  ('40000000-0000-4000-8000-000000000005', 'org_220u_b', 'owner_b_220u', 'Owner');

insert into public.stores (id, organization_id, name, status) values
  ('40000000-0000-4000-8000-000000000101', 'org_220u_a', 'Fixture 2.20U A', 'active'),
  ('40000000-0000-4000-8000-000000000102', 'org_220u_b', 'Fixture 2.20U B', 'active');

insert into public.connections (id, organization_id, store_id, provider, external_account_id, status) values
  ('40000000-0000-4000-8000-000000000201', 'org_220u_a', '40000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220u-a1', 'active'),
  ('40000000-0000-4000-8000-000000000202', 'org_220u_a', '40000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220u-a2', 'active'),
  ('40000000-0000-4000-8000-000000000203', 'org_220u_a', '40000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220u-a3', 'active'),
  ('40000000-0000-4000-8000-000000000204', 'org_220u_a', '40000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220u-a4', 'active'),
  ('40000000-0000-4000-8000-000000000205', 'org_220u_a', '40000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220u-a5', 'active'),
  ('40000000-0000-4000-8000-000000000206', 'org_220u_a', '40000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220u-a6', 'active'),
  ('40000000-0000-4000-8000-000000000207', 'org_220u_a', '40000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220u-a7', 'active'),
  ('40000000-0000-4000-8000-000000000208', 'org_220u_a', '40000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220u-a8', 'active'),
  ('40000000-0000-4000-8000-000000000209', 'org_220u_b', '40000000-0000-4000-8000-000000000102', 'mercado-libre', 'account-220u-b1', 'active');

create temp table matrix_runs (label text primary key, run_id uuid not null);

insert into public.listing_sync_runs (
  organization_id, store_id, connection_id, actor_membership_id, kind, idempotency_key,
  status, started_at, last_checkpoint_at, discovered_count, requested_count,
  fetched_count, persisted_count, failed_count, pages_count, batches_count
)
select
  'org_220u_a', '40000000-0000-4000-8000-000000000101',
  ('40000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  '40000000-0000-4000-8000-000000000003', 'listing_backfill',
  ('40000000-0000-4000-9000-' || lpad(sequence::text, 12, '0'))::uuid,
  'running', now() - interval '30 minutes',
  case when sequence = 203 then now() - interval '14 minutes' else now() - interval '20 minutes' end,
  1, 1, case when sequence = 204 then 0 else 1 end,
  case when sequence = 204 then 0 else 1 end, 0, 1, 1
from generate_series(201, 208) as sequence;

insert into matrix_runs
select right(label, 3), id from (
  select connection_id::text as label, id
  from public.listing_sync_runs where organization_id = 'org_220u_a'
) as created;

insert into public.listing_sync_runs (
  organization_id, store_id, connection_id, actor_membership_id, kind, idempotency_key,
  status, started_at, last_checkpoint_at
) values (
  'org_220u_b', '40000000-0000-4000-8000-000000000102',
  '40000000-0000-4000-8000-000000000209', '40000000-0000-4000-8000-000000000005',
  'listing_backfill', '40000000-0000-4000-9000-000000000209', 'running',
  now() - interval '30 minutes', now() - interval '20 minutes'
);

do $$
declare result record; original_actor uuid; original_checkpoint timestamptz;
begin
  select actor_membership_id, last_checkpoint_at into original_actor, original_checkpoint
  from public.listing_sync_runs where id = (select run_id from matrix_runs where label = '201');
  select * into result from public.recover_stale_listing_sync_run(
    'org_220u_a', (select run_id from matrix_runs where label = '201'),
    '40000000-0000-4000-8000-000000000001', 'succeeded', 'FINALIZE_INTERRUPTED',
    now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(result.outcome = 'recovered' and result.status = 'succeeded', 'Owner succeeded outcome');
  perform pg_temp.assert_true(
    result.organization_id = 'org_220u_a'
    and result.store_id = '40000000-0000-4000-8000-000000000101'
    and result.connection_id = '40000000-0000-4000-8000-000000000201',
    'tenant Store Connection bindings preserved'
  );
  perform pg_temp.assert_true(result.actor_membership_id = original_actor and result.last_checkpoint_at = original_checkpoint, 'original actor/checkpoint preserved');
  perform pg_temp.assert_true(result.discovered_count = 1 and result.persisted_count = 1, 'counters preserved');
end;
$$;
select pg_temp.assert_true(
  (select count(*) = 1 from public.audit_events where resource_id = (select run_id::text from matrix_runs where label = '201')
   and action = 'listing.sync.recovered' and actor_membership_id = '40000000-0000-4000-8000-000000000001'
   and metadata->>'recovery_reason' = 'FINALIZE_INTERRUPTED'),
  'Owner recovery audit actor and reason'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.audit_events
   where resource_id = (select run_id::text from matrix_runs where label = '201')
     and action = 'listing.sync.succeeded'
     and organization_id = 'org_220u_a'
     and store_id = '40000000-0000-4000-8000-000000000101'
     and metadata->>'provider' = 'mercado-libre'),
  'terminal audit Store and provider bindings'
);
\echo 'A Owner succeeded recovery and audit: PASS'

do $$
declare result record;
begin
  select * into result from public.recover_stale_listing_sync_run(
    'org_220u_a', (select run_id from matrix_runs where label = '202'),
    '40000000-0000-4000-8000-000000000002', 'failed', 'PROCESS_CRASHED', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(result.outcome = 'recovered' and result.status = 'failed'
    and result.error_code = 'administrative_recovery' and result.error_summary is null, 'Manager failed outcome');
end;
$$;
\echo 'B Manager failed recovery: PASS'

do $$
declare result record;
begin
  select * into result from public.recover_stale_listing_sync_run(
    'org_220u_a', (select run_id from matrix_runs where label = '203'),
    '40000000-0000-4000-8000-000000000001', 'failed', 'MANUAL_ABORT', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(result.outcome = 'not_stale' and result.status = 'running', 'fresh run unchanged');
end;
$$;
\echo 'C non-stale protection: PASS'

do $$
declare result record;
begin
  select * into result from public.recover_stale_listing_sync_run(
    'org_220u_a', (select run_id from matrix_runs where label = '204'),
    '40000000-0000-4000-8000-000000000001', 'succeeded', 'UNKNOWN_EXECUTION_STATE', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(result.outcome = 'not_recoverable' and result.status = 'running', 'incomplete success rejected');
end;
$$;
\echo 'D incomplete success evidence: PASS'

do $$
declare actor uuid;
begin
  foreach actor in array array[
    '40000000-0000-4000-8000-000000000003'::uuid,
    '40000000-0000-4000-8000-000000000004'::uuid
  ] loop
    begin
      perform * from public.recover_stale_listing_sync_run(
        'org_220u_a', (select run_id from matrix_runs where label = '205'), actor,
        'failed', 'MANUAL_ABORT', now() - interval '15 minutes'
      );
      raise exception 'expected role rejection';
    exception when others then
      if sqlerrm <> 'listing_sync_recovery_actor_invalid' then raise; end if;
    end;
  end loop;
end;
$$;
\echo 'E Employee and Client denied: PASS'

do $$
begin
  begin
    perform * from public.recover_stale_listing_sync_run(
      'org_220u_b', (select run_id from matrix_runs where label = '205'),
      '40000000-0000-4000-8000-000000000005', 'failed', 'MANUAL_ABORT', now() - interval '15 minutes'
    );
    raise exception 'expected tenant rejection';
  exception when others then
    if sqlerrm <> 'listing_sync_recovery_scope_invalid' then raise; end if;
  end;
end;
$$;
\echo 'F cross-tenant run denied: PASS'

update public.listing_sync_runs set last_checkpoint_at = now() - interval '15 minutes'
where id = (select run_id from matrix_runs where label = '206');
select pg_temp.assert_true(
  (select outcome = 'recovered' from public.recover_stale_listing_sync_run(
    'org_220u_a', (select run_id from matrix_runs where label = '206'),
    '40000000-0000-4000-8000-000000000001', 'failed', 'MANUAL_ABORT', now() - interval '15 minutes')),
  'exact boundary stale'
);
\echo 'G exact stale boundary: PASS'

select pg_temp.assert_true(
  (select outcome = 'already_terminal' from public.recover_stale_listing_sync_run(
    'org_220u_a', (select run_id from matrix_runs where label = '201'),
    '40000000-0000-4000-8000-000000000001', 'succeeded', 'FINALIZE_INTERRUPTED', now() - interval '15 minutes')),
  'second recovery controlled'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.audit_events where resource_id = (select run_id::text from matrix_runs where label = '201')
   and action = 'listing.sync.recovered'), 'no duplicate recovery audit'
);
\echo 'H repeat recovery idempotent: PASS'

create function pg_temp.fail_recovery_audit() returns trigger language plpgsql as $$
begin
  if new.action = 'listing.sync.recovered' and new.resource_id = (select run_id::text from matrix_runs where label = '207')
  then raise exception 'matrix recovery audit failure'; end if;
  return new;
end;
$$;
create trigger matrix_fail_recovery_audit before insert on public.audit_events
for each row execute function pg_temp.fail_recovery_audit();
do $$
begin
  begin
    perform * from public.recover_stale_listing_sync_run(
      'org_220u_a', (select run_id from matrix_runs where label = '207'),
      '40000000-0000-4000-8000-000000000001', 'failed', 'PROCESS_CRASHED', now() - interval '15 minutes'
    );
    raise exception 'expected audit rollback';
  exception when others then
    if sqlerrm = 'expected audit rollback' then raise; end if;
  end;
  perform pg_temp.assert_true((select status = 'running' from public.listing_sync_runs
    where id = (select run_id from matrix_runs where label = '207')), 'status rollback');
  perform pg_temp.assert_true((select count(*) = 0 from public.audit_events
    where resource_id = (select run_id::text from matrix_runs where label = '207')
      and action in ('listing.sync.failed', 'listing.sync.recovered')), 'audit rollback');
end;
$$;
drop trigger matrix_fail_recovery_audit on public.audit_events;
\echo 'I recovery and audit atomic: PASS'

select pg_temp.assert_true(
  (select count(*) = 0 from public.listing_sync_runs
   where connection_id = '40000000-0000-4000-8000-000000000201'
     and kind = 'listing_backfill' and status = 'running'),
  'running gate liberated without starting another run'
);
\echo 'J execution gate liberated: PASS'

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.recover_stale_listing_sync_run(text,uuid,uuid,text,text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.recover_stale_listing_sync_run(text,uuid,uuid,text,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.recover_stale_listing_sync_run(text,uuid,uuid,text,text,timestamptz)', 'execute'),
  'service role only RPC'
);
\echo 'K RPC grants: PASS'

insert into public.audit_events (
  organization_id, store_id, actor_membership_id, action, resource_type, resource_id
) values (
  'org_220u_a', '40000000-0000-4000-8000-000000000101',
  '40000000-0000-4000-8000-000000000003', 'listing.sync.failed',
  'listing_sync_run', (select run_id::text from matrix_runs where label = '208')
);
select pg_temp.assert_true(
  (select outcome = 'not_recoverable' from public.recover_stale_listing_sync_run(
    'org_220u_a', (select run_id from matrix_runs where label = '208'),
    '40000000-0000-4000-8000-000000000001', 'failed', 'UNKNOWN_EXECUTION_STATE',
    now() - interval '15 minutes')),
  'running run with terminal audit rejected'
);
\echo 'L terminal audit inconsistency protection: PASS'

\echo 'MATRIX 12/12 PASS'
rollback;
