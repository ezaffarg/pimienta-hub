\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception '2.20T assertion failed: %', message;
  end if;
end;
$$;

create temp table matrix_runs (
  label text primary key,
  run_id uuid not null
);

insert into public.hub_memberships (id, organization_id, clerk_user_id, role)
values
  ('30000000-0000-4000-8000-000000000001', 'org_220t_a', 'user_220t_a', 'Owner'),
  ('30000000-0000-4000-8000-000000000002', 'org_220t_b', 'user_220t_b', 'Owner');

insert into public.stores (id, organization_id, name, status)
values
  ('30000000-0000-4000-8000-000000000101', 'org_220t_a', 'Fixture 2.20T A', 'active'),
  ('30000000-0000-4000-8000-000000000102', 'org_220t_b', 'Fixture 2.20T B', 'active');

insert into public.connections (
  id, organization_id, store_id, provider, external_account_id, status
)
values
  ('30000000-0000-4000-8000-000000000201', 'org_220t_a', '30000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220t-a1', 'active'),
  ('30000000-0000-4000-8000-000000000202', 'org_220t_a', '30000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220t-a2', 'active'),
  ('30000000-0000-4000-8000-000000000204', 'org_220t_a', '30000000-0000-4000-8000-000000000101', 'mercado-libre', 'account-220t-a4', 'active'),
  ('30000000-0000-4000-8000-000000000203', 'org_220t_b', '30000000-0000-4000-8000-000000000102', 'mercado-libre', 'account-220t-b1', 'active');

-- A. Start creates one running run.
do $$
declare
  result record;
begin
  select * into result
  from public.start_listing_sync_run(
    'org_220t_a',
    '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000201',
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000301'
  );
  perform pg_temp.assert_true(result.outcome = 'started', 'A outcome');
  perform pg_temp.assert_true(result.status = 'running' and result.completed_at is null, 'A running');
  insert into matrix_runs values ('A', result.id);
end;
$$;
\echo 'A start running: PASS'

-- B. Started audit is part of the same start transaction.
select pg_temp.assert_true(
  (select count(*) = 1
   from public.audit_events
   where action = 'listing.sync.started'
     and resource_type = 'listing_sync_run'
     and resource_id = (select run_id::text from matrix_runs where label = 'A')
     and metadata = '{"kind":"listing_backfill","provider":"mercado-libre","status":"running"}'::jsonb),
  'B started audit'
);
\echo 'B audit started: PASS'

-- C. The same idempotency key returns the existing run.
do $$
declare
  result record;
begin
  select * into result
  from public.start_listing_sync_run(
    'org_220t_a',
    '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000201',
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000301'
  );
  perform pg_temp.assert_true(result.outcome = 'reused', 'C outcome');
  perform pg_temp.assert_true(result.id = (select run_id from matrix_runs where label = 'A'), 'C same run');
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.listing_sync_runs where connection_id = '30000000-0000-4000-8000-000000000201'),
    'C cardinality'
  );
end;
$$;
\echo 'C idempotency reuse: PASS'

-- D. A different key cannot start beside an existing running run.
do $$
declare
  result record;
begin
  select * into result
  from public.start_listing_sync_run(
    'org_220t_a',
    '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000201',
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000302'
  );
  perform pg_temp.assert_true(result.outcome = 'already_running', 'D outcome');
  perform pg_temp.assert_true(result.id = (select run_id from matrix_runs where label = 'A'), 'D running run');
end;
$$;
\echo 'D already running: PASS'

-- E. A Connection from another tenant cannot be used.
do $$
begin
  begin
    perform * from public.start_listing_sync_run(
      'org_220t_a',
      '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000203',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000303'
    );
    raise exception 'E expected rejection';
  exception
    when others then
      if sqlerrm = 'E expected rejection' then raise; end if;
  end;
end;
$$;
\echo 'E cross-tenant Connection: PASS'

-- F. An actor membership from another tenant cannot be used.
do $$
begin
  begin
    perform * from public.start_listing_sync_run(
      'org_220t_a',
      '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000202',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000304'
    );
    raise exception 'F expected rejection';
  exception
    when others then
      if sqlerrm = 'F expected rejection' then raise; end if;
  end;
end;
$$;
\echo 'F cross-tenant actor: PASS'

-- G. Progress is persisted without cursor data.
select * from public.checkpoint_listing_sync_run(
  'org_220t_a',
  '30000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000201',
  (select run_id from matrix_runs where label = 'A'),
  3, 3, 2, 2, 1, 1, 1
);
select pg_temp.assert_true(
  (select discovered_count = 3 and requested_count = 3 and fetched_count = 2
     and persisted_count = 2 and failed_count = 1 and pages_count = 1 and batches_count = 1
   from public.listing_sync_runs where id = (select run_id from matrix_runs where label = 'A')),
  'G checkpoint counters'
);
\echo 'G progress checkpoint: PASS'

-- H. Negative or decreasing counters are rejected.
do $$
begin
  begin
    perform * from public.checkpoint_listing_sync_run(
      'org_220t_a',
      '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000201',
      (select run_id from matrix_runs where label = 'A'),
      -1, 3, 2, 2, 1, 1, 1
    );
    raise exception 'H expected negative rejection';
  exception
    when others then
      if sqlerrm <> 'listing_sync_counters_invalid' then raise; end if;
  end;

  begin
    perform * from public.checkpoint_listing_sync_run(
      'org_220t_a',
      '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000201',
      (select run_id from matrix_runs where label = 'A'),
      2, 3, 2, 2, 1, 1, 1
    );
    raise exception 'H expected monotonic rejection';
  exception
    when others then
      if sqlerrm <> 'listing_sync_checkpoint_rejected' then raise; end if;
  end;

  begin
    perform * from public.finalize_listing_sync_run(
      'org_220t_a',
      '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000201',
      (select run_id from matrix_runs where label = 'A'),
      'succeeded', 3, 3, 2, -1, 1, 1, 1, null, null
    );
    raise exception 'H expected negative finalize rejection';
  exception
    when others then
      if sqlerrm <> 'listing_sync_counters_invalid' then raise; end if;
  end;
end;
$$;
\echo 'H invalid counters: PASS'

-- I. Succeeded closes once with no error fields and writes terminal audit.
select * from public.finalize_listing_sync_run(
  'org_220t_a',
  '30000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000201',
  (select run_id from matrix_runs where label = 'A'),
  'succeeded', 3, 3, 2, 2, 1, 1, 1, null, null
);
select pg_temp.assert_true(
  (select status = 'succeeded' and completed_at is not null
     and last_checkpoint_at is not null
     and discovered_count = 3 and requested_count = 3 and fetched_count = 2
     and persisted_count = 2 and failed_count = 1 and pages_count = 1 and batches_count = 1
     and error_code is null and error_summary is null
   from public.listing_sync_runs where id = (select run_id from matrix_runs where label = 'A')),
  'I succeeded state'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.audit_events
   where action = 'listing.sync.succeeded'
     and organization_id = 'org_220t_a'
     and store_id = '30000000-0000-4000-8000-000000000101'
     and actor_membership_id = '30000000-0000-4000-8000-000000000001'
     and resource_id = (select run_id::text from matrix_runs where label = 'A')
     and metadata = '{"kind":"listing_backfill","provider":"mercado-libre","status":"succeeded"}'::jsonb),
  'I succeeded audit'
);
\echo 'I succeeded: PASS'

-- J. Partial requires a safe allowlisted error.
do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000305'
  );
  insert into matrix_runs values ('J', result.id);
  perform * from public.finalize_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000201', result.id,
    'partial', 1, 1, 0, 0, 1, 1, 1,
    'partial_item_failure', 'One or more listing items could not be synchronized'
  );
  perform pg_temp.assert_true(
    (select status = 'partial' and completed_at is not null and last_checkpoint_at is not null
       and discovered_count = 1 and requested_count = 1 and fetched_count = 0
       and persisted_count = 0 and failed_count = 1 and pages_count = 1 and batches_count = 1
       and error_code = 'partial_item_failure'
       and error_summary = 'One or more listing items could not be synchronized'
     from public.listing_sync_runs where id = result.id),
    'J partial state'
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.audit_events
     where action = 'listing.sync.partial'
       and resource_id = result.id::text
       and metadata = '{"kind":"listing_backfill","provider":"mercado-libre","status":"partial"}'::jsonb),
    'J partial audit'
  );
end;
$$;
\echo 'J partial: PASS'

-- K. Failed records a controlled fatal classification.
do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000306'
  );
  insert into matrix_runs values ('K', result.id);
  perform * from public.finalize_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000201', result.id,
    'failed', 0, 0, 0, 0, 0, 0, 0,
    'provider_timeout', 'The provider timed out during the listing sync'
  );
  perform pg_temp.assert_true(
    (select status = 'failed' and completed_at is not null and last_checkpoint_at is not null
       and discovered_count = 0 and requested_count = 0 and fetched_count = 0
       and persisted_count = 0 and failed_count = 0 and pages_count = 0 and batches_count = 0
       and error_code = 'provider_timeout'
       and error_summary = 'The provider timed out during the listing sync'
     from public.listing_sync_runs where id = result.id),
    'K failed state'
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.audit_events
     where action = 'listing.sync.failed'
       and resource_id = result.id::text
       and metadata = '{"kind":"listing_backfill","provider":"mercado-libre","status":"failed"}'::jsonb),
    'K failed audit'
  );
end;
$$;
\echo 'K failed: PASS'

-- L. A terminal run cannot transition again.
do $$
begin
  begin
    perform * from public.finalize_listing_sync_run(
      'org_220t_a', '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000201',
      (select run_id from matrix_runs where label = 'K'),
      'failed', 0, 0, 0, 0, 0, 0, 0,
      'provider_timeout', 'The provider timed out during the listing sync'
    );
    raise exception 'L expected terminal rejection';
  exception
    when others then
      if sqlerrm = 'L expected terminal rejection' then raise; end if;
  end;
end;
$$;
\echo 'L terminal transition protection: PASS'

-- M. A terminal audit failure rolls the status update back.
create function pg_temp.fail_terminal_sync_audit()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'listing.sync.failed'
    and new.resource_id = (select run_id::text from matrix_runs where label = 'M') then
    raise exception 'matrix terminal audit failure';
  end if;
  return new;
end;
$$;

do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000307'
  );
  insert into matrix_runs values ('M', result.id);
end;
$$;

create trigger matrix_fail_terminal_sync_audit
before insert on public.audit_events
for each row execute function pg_temp.fail_terminal_sync_audit();

do $$
begin
  begin
    perform * from public.finalize_listing_sync_run(
      'org_220t_a', '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000201',
      (select run_id from matrix_runs where label = 'M'),
      'failed', 0, 0, 0, 0, 0, 0, 0,
      'persistence_failure', 'Listing sync persistence failed safely'
    );
    raise exception 'M expected audit failure';
  exception
    when others then
      if sqlerrm = 'M expected audit failure' then raise; end if;
  end;
  perform pg_temp.assert_true(
    (select status = 'running' and completed_at is null
     from public.listing_sync_runs where id = (select run_id from matrix_runs where label = 'M')),
    'M terminal update rollback'
  );
end;
$$;

drop trigger matrix_fail_terminal_sync_audit on public.audit_events;
select * from public.finalize_listing_sync_run(
  'org_220t_a', '30000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000201',
  (select run_id from matrix_runs where label = 'M'),
  'failed', 0, 0, 0, 0, 0, 0, 0,
  'persistence_failure', 'Listing sync persistence failed safely'
);
\echo 'M terminal audit atomic: PASS'

-- N. The partial unique index is the final concurrency invariant.
do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000308'
  );
  insert into matrix_runs values ('N', result.id);
  begin
    insert into public.listing_sync_runs (
      organization_id, store_id, connection_id, actor_membership_id,
      kind, idempotency_key, status
    ) values (
      'org_220t_a', '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000001',
      'listing_backfill', '30000000-0000-4000-8000-000000000309', 'running'
    );
    raise exception 'N expected unique rejection';
  exception
    when unique_violation then null;
  end;
end;
$$;
select * from public.finalize_listing_sync_run(
  'org_220t_a', '30000000-0000-4000-8000-000000000101',
  '30000000-0000-4000-8000-000000000201',
  (select run_id from matrix_runs where label = 'N'),
  'succeeded', 0, 0, 0, 0, 0, 0, 0, null, null
);
\echo 'N unique running invariant: PASS'

-- O. Browser roles have neither table nor RPC privileges.
select pg_temp.assert_true(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.listing_sync_runs'::regclass),
  'O RLS enabled'
);
select pg_temp.assert_true(
  (select count(*) = 0 from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'listing_sync_runs'),
  'O no browser policies'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.listing_sync_runs', 'select')
  and not has_table_privilege('authenticated', 'public.listing_sync_runs', 'insert')
  and has_table_privilege('service_role', 'public.listing_sync_runs', 'select,insert,update,delete'),
  'O table grants'
);
select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.start_listing_sync_run(text,uuid,uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.checkpoint_listing_sync_run(text,uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint)', 'execute')
  and not has_function_privilege('anon', 'public.finalize_listing_sync_run(text,uuid,uuid,uuid,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.start_listing_sync_run(text,uuid,uuid,uuid,uuid)', 'execute'),
  'O RPC grants'
);
\echo 'O RLS and grants: PASS'

-- P. A start audit failure rolls the new run back completely.
create function pg_temp.fail_started_sync_audit()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'listing.sync.started'
    and new.store_id = '30000000-0000-4000-8000-000000000101' then
    raise exception 'matrix start audit failure';
  end if;
  return new;
end;
$$;

create trigger matrix_fail_started_sync_audit
before insert on public.audit_events
for each row execute function pg_temp.fail_started_sync_audit();

do $$
begin
  begin
    perform * from public.start_listing_sync_run(
      'org_220t_a', '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000202', '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000310'
    );
    raise exception 'P expected audit failure';
  exception
    when others then
      if sqlerrm = 'P expected audit failure' then raise; end if;
  end;
  perform pg_temp.assert_true(
    (select count(*) = 0 from public.listing_sync_runs
     where connection_id = '30000000-0000-4000-8000-000000000202'),
    'P start rollback'
  );
end;
$$;

drop trigger matrix_fail_started_sync_audit on public.audit_events;
\echo 'P start audit rollback: PASS'

-- Q. An error code outside the approved catalogue cannot finalize a run.
do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000311'
  );
  begin
    perform * from public.finalize_listing_sync_run(
      'org_220t_a', '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000202', result.id,
      'failed', 0, 0, 0, 0, 0, 0, 0,
      'unapproved_error', 'A controlled failure summary'
    );
    raise exception 'Q expected invalid error code rejection';
  exception
    when others then
      if sqlerrm = 'Q expected invalid error code rejection' then raise; end if;
  end;
  perform pg_temp.assert_true(
    (select status = 'running' and completed_at is null and error_code is null
     from public.listing_sync_runs where id = result.id),
    'Q invalid terminal transition persisted'
  );
  perform pg_temp.assert_true(
    (select count(*) = 0 from public.audit_events
     where resource_id = result.id::text and action like 'listing.sync.%' and action <> 'listing.sync.started'),
    'Q invalid terminal audit persisted'
  );
  perform * from public.finalize_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', result.id,
    'failed', 0, 0, 0, 0, 0, 0, 0,
    'persistence_failure', 'Listing sync persistence failed safely'
  );
end;
$$;
\echo 'Q invalid error code: PASS'

-- R. The existing DB summary boundary rejects prohibited material.
do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000312'
  );
  begin
    perform * from public.finalize_listing_sync_run(
      'org_220t_a', '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000202', result.id,
      'failed', 0, 0, 0, 0, 0, 0, 0,
      'credential_failure', 'access token must not be persisted'
    );
    raise exception 'R expected unsafe summary rejection';
  exception
    when others then
      if sqlerrm = 'R expected unsafe summary rejection' then raise; end if;
  end;
  perform pg_temp.assert_true(
    (select status = 'running' and completed_at is null and error_summary is null
     from public.listing_sync_runs where id = result.id),
    'R unsafe terminal transition persisted'
  );
  perform * from public.finalize_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', result.id,
    'failed', 0, 0, 0, 0, 0, 0, 0,
    'credential_failure', 'A valid provider credential was unavailable'
  );
end;
$$;
\echo 'R safe error summary boundary: PASS'

-- S. NULL counters are rejected explicitly by checkpoint and finalize.
do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000313'
  );
  begin
    perform * from public.checkpoint_listing_sync_run(
      'org_220t_a', '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000202', result.id,
      null, 0, 0, 0, 0, 0, 0
    );
    raise exception 'S expected NULL checkpoint rejection';
  exception
    when others then
      if sqlerrm <> 'listing_sync_counters_invalid' then raise; end if;
  end;
  begin
    perform * from public.finalize_listing_sync_run(
      'org_220t_a', '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000202', result.id,
      'succeeded', 0, 0, 0, 0, 0, null, 0, null, null
    );
    raise exception 'S expected NULL finalize rejection';
  exception
    when others then
      if sqlerrm <> 'listing_sync_counters_invalid' then raise; end if;
  end;
  perform pg_temp.assert_true(
    (select status = 'running' and completed_at is null
     from public.listing_sync_runs where id = result.id),
    'S NULL counters changed run'
  );
  perform * from public.finalize_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', result.id,
    'succeeded', 0, 0, 0, 0, 0, 0, 0, null, null
  );
end;
$$;
\echo 'S NULL counters: PASS'

-- T. A historical idempotency key is reusable after its Connection is disabled.
do $$
declare
  original record;
  reused record;
begin
  select * into original from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000204', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000314'
  );
  perform * from public.finalize_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000204', original.id,
    'succeeded', 0, 0, 0, 0, 0, 0, 0, null, null
  );
  update public.connections
  set status = 'disabled'
  where id = '30000000-0000-4000-8000-000000000204';

  select * into reused from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000204', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000314'
  );
  perform pg_temp.assert_true(reused.outcome = 'reused' and reused.id = original.id, 'T reused run');
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.listing_sync_runs
     where connection_id = '30000000-0000-4000-8000-000000000204'),
    'T duplicate run'
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.audit_events
     where action = 'listing.sync.started' and resource_id = original.id::text),
    'T duplicate started audit'
  );
end;
$$;
\echo 'T historical reuse on disabled Connection: PASS'

-- U. A new key cannot start work on a disabled Connection.
do $$
begin
  begin
    perform * from public.start_listing_sync_run(
      'org_220t_a', '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000204', '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000315'
    );
    raise exception 'U expected disabled rejection';
  exception
    when others then
      if sqlerrm <> 'listing_sync_connection_inactive' then raise; end if;
  end;
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.listing_sync_runs
     where connection_id = '30000000-0000-4000-8000-000000000204'),
    'U disabled Connection created run'
  );
end;
$$;
\echo 'U new key on disabled Connection: PASS'

-- V. Two independent runs upsert the same real DB listing row idempotently.
do $$
declare
  run_a record;
  run_b record;
  first_listing_id uuid;
begin
  select * into run_a from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000316'
  );
  insert into public.listings (
    organization_id, store_id, connection_id, external_listing_id,
    title, status, last_synced_at
  ) values (
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', 'MLA-220T-FIXTURE',
    'Fixture run A', 'active', '2026-08-25T22:10:00Z'
  )
  on conflict (connection_id, external_listing_id) do update
  set title = excluded.title, last_synced_at = excluded.last_synced_at,
      updated_at = excluded.last_synced_at;
  select id into first_listing_id from public.listings
  where connection_id = '30000000-0000-4000-8000-000000000202'
    and external_listing_id = 'MLA-220T-FIXTURE';
  perform * from public.finalize_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', run_a.id,
    'succeeded', 1, 1, 1, 1, 0, 1, 1, null, null
  );

  select * into run_b from public.start_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000317'
  );
  insert into public.listings (
    organization_id, store_id, connection_id, external_listing_id,
    title, status, last_synced_at
  ) values (
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', 'MLA-220T-FIXTURE',
    'Fixture run B', 'active', '2026-08-25T22:11:00Z'
  )
  on conflict (connection_id, external_listing_id) do update
  set title = excluded.title, last_synced_at = excluded.last_synced_at,
      updated_at = excluded.last_synced_at;
  perform * from public.finalize_listing_sync_run(
    'org_220t_a', '30000000-0000-4000-8000-000000000101',
    '30000000-0000-4000-8000-000000000202', run_b.id,
    'succeeded', 1, 1, 1, 1, 0, 1, 1, null, null
  );

  perform pg_temp.assert_true(run_a.id <> run_b.id, 'V independent runs');
  perform pg_temp.assert_true(
    (select count(*) = 1 and bool_and(id = first_listing_id)
       and bool_and(organization_id = 'org_220t_a')
       and bool_and(store_id = '30000000-0000-4000-8000-000000000101')
       and bool_and(title = 'Fixture run B')
     from public.listings
     where connection_id = '30000000-0000-4000-8000-000000000202'
       and external_listing_id = 'MLA-220T-FIXTURE'),
    'V listing upsert idempotency and bindings'
  );
end;
$$;
\echo 'V cross-run listing DB idempotency: PASS'

\echo 'MATRIX 22/22 PASS'

rollback;

select
  (
    (select count(*) from public.hub_memberships where organization_id like 'org_220t_%')
    + (select count(*) from public.stores where organization_id like 'org_220t_%')
    + (select count(*) from public.connections where organization_id like 'org_220t_%')
    + (select count(*) from public.listings where organization_id like 'org_220t_%')
    + (select count(*) from public.listing_sync_runs where organization_id like 'org_220t_%')
    + (select count(*) from public.audit_events where organization_id like 'org_220t_%')
  ) as persisted_fixture_rows;
