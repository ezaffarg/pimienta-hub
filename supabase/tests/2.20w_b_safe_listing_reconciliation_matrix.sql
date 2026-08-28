\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception '2.20W-B assertion failed: %', message; end if;
end;
$$;

insert into public.hub_memberships (id, organization_id, clerk_user_id, role) values
  ('50000000-0000-4000-8000-000000000001', 'org_220w_a', 'owner_220w_a', 'Owner'),
  ('50000000-0000-4000-8000-000000000002', 'org_220w_b', 'owner_220w_b', 'Owner');

insert into public.stores (id, organization_id, name, status) values
  ('50000000-0000-4000-8000-000000000101', 'org_220w_a', 'W A1', 'active'),
  ('50000000-0000-4000-8000-000000000102', 'org_220w_a', 'W A2', 'active'),
  ('50000000-0000-4000-8000-000000000103', 'org_220w_b', 'W B1', 'active');

insert into public.connections (id, organization_id, store_id, provider, external_account_id, status) values
  ('50000000-0000-4000-8000-000000000201', 'org_220w_a', '50000000-0000-4000-8000-000000000101', 'mercado-libre', 'w-a1', 'active'),
  ('50000000-0000-4000-8000-000000000202', 'org_220w_a', '50000000-0000-4000-8000-000000000102', 'mercado-libre', 'w-a2', 'active'),
  ('50000000-0000-4000-8000-000000000203', 'org_220w_b', '50000000-0000-4000-8000-000000000103', 'mercado-libre', 'w-b1', 'active'),
  ('50000000-0000-4000-8000-000000000204', 'org_220w_a', '50000000-0000-4000-8000-000000000101', 'mercado-libre', 'w-a3', 'active');

insert into public.listings (
  id, organization_id, store_id, connection_id, external_listing_id,
  title, status, last_synced_at
) values
  ('50000000-0000-4000-8000-000000000301', 'org_220w_a', '50000000-0000-4000-8000-000000000101', '50000000-0000-4000-8000-000000000201', 'MLA-W-1', 'Legacy one', 'active', now()),
  ('50000000-0000-4000-8000-000000000302', 'org_220w_a', '50000000-0000-4000-8000-000000000101', '50000000-0000-4000-8000-000000000201', 'MLA-W-2', 'Legacy two', 'active', now()),
  ('50000000-0000-4000-8000-000000000303', 'org_220w_a', '50000000-0000-4000-8000-000000000102', '50000000-0000-4000-8000-000000000202', 'MLA-W-3', 'Other store', 'paused', now());

select pg_temp.assert_true(
  (select bool_and(reconciliation_state = 'seen' and last_seen_sync_run_id is null
    and not_seen_since is null and consecutive_not_seen_count = 0)
   from public.listings where organization_id = 'org_220w_a'),
  'conservative Listing defaults'
);
select pg_temp.assert_true(
  exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'listing_sync_runs' and column_name = 'reconciliation_eligible'),
  'run reconciliation columns exist'
);
\echo 'A schema and conservative backfill: PASS'

do $$
begin
  begin
    update public.listings set reconciliation_state = 'confirmed_missing'
    where id = '50000000-0000-4000-8000-000000000301';
    raise exception 'expected invalid state rejection';
  exception when check_violation then null;
  end;
end;
$$;
\echo 'B invalid reconciliation state: PASS'

insert into public.listing_sync_runs (
  id, organization_id, store_id, connection_id, actor_membership_id, kind,
  idempotency_key, status, completed_at
) values
  ('50000000-0000-4000-8000-000000000401', 'org_220w_a', '50000000-0000-4000-8000-000000000102', '50000000-0000-4000-8000-000000000202', '50000000-0000-4000-8000-000000000001', 'listing_backfill', '50000000-0000-4000-9000-000000000401', 'succeeded', now()),
  ('50000000-0000-4000-8000-000000000402', 'org_220w_b', '50000000-0000-4000-8000-000000000103', '50000000-0000-4000-8000-000000000203', '50000000-0000-4000-8000-000000000002', 'listing_backfill', '50000000-0000-4000-9000-000000000402', 'succeeded', now()),
  ('50000000-0000-4000-8000-000000000403', 'org_220w_a', '50000000-0000-4000-8000-000000000101', '50000000-0000-4000-8000-000000000204', '50000000-0000-4000-8000-000000000001', 'listing_backfill', '50000000-0000-4000-9000-000000000403', 'succeeded', now());

do $$
declare target uuid;
begin
  foreach target in array array[
    '50000000-0000-4000-8000-000000000401'::uuid,
    '50000000-0000-4000-8000-000000000402'::uuid,
    '50000000-0000-4000-8000-000000000403'::uuid
  ] loop
    begin
      update public.listings set last_seen_sync_run_id = target
      where id = '50000000-0000-4000-8000-000000000301';
      raise exception 'expected cross-scope rejection';
    exception when foreign_key_violation then null;
    end;
  end loop;
end;
$$;
\echo 'C cross-Organization, Store and Connection run linkage: PASS'

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.persist_listing_sync_batch_for_run(text,uuid,uuid,uuid,timestamptz,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.persist_listing_sync_batch_for_run(text,uuid,uuid,uuid,timestamptz,jsonb)', 'EXECUTE')
  and not has_function_privilege('public', 'public.persist_listing_sync_batch_for_run(text,uuid,uuid,uuid,timestamptz,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.persist_listing_sync_batch_for_run(text,uuid,uuid,uuid,timestamptz,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finalize_listing_sync_run_with_reconciliation(text,uuid,uuid,uuid,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean,text,text)', 'EXECUTE'),
  'RPC grants'
);
\echo 'D service_role-only RPC boundary: PASS'

create temp table matrix_runs (label text primary key, run_id uuid not null);

do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220w_a', '50000000-0000-4000-8000-000000000101',
    '50000000-0000-4000-8000-000000000201', '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-9000-000000000501'
  );
  insert into matrix_runs values ('first', result.id);
end;
$$;

update public.listings
set reconciliation_state = 'missing_candidate',
    not_seen_since = now() - interval '1 day',
    consecutive_not_seen_count = 1
where id = '50000000-0000-4000-8000-000000000301';

select * from public.persist_listing_sync_batch_for_run(
  'org_220w_a', '50000000-0000-4000-8000-000000000101',
  '50000000-0000-4000-8000-000000000201',
  (select run_id from matrix_runs where label = 'first'), now(),
  '[{"external_listing_id":"MLA-W-1","title":"Seen again","status":"active","price":10,"currency_id":"ARS","available_quantity":1,"sold_quantity":0}]'::jsonb
);

select pg_temp.assert_true(
  (select reconciliation_state = 'seen' and not_seen_since is null
    and consecutive_not_seen_count = 0
    and last_seen_sync_run_id = (select run_id from matrix_runs where label = 'first')
   from public.listings where id = '50000000-0000-4000-8000-000000000301'),
  'reappearance transition'
);
select pg_temp.assert_true(
  (select reappeared_count = 1 from public.listing_sync_runs
   where id = (select run_id from matrix_runs where label = 'first')),
  'reappearance counted once'
);
\echo 'E positive evidence and reappearance: PASS'

select * from public.persist_listing_sync_batch_for_run(
  'org_220w_a', '50000000-0000-4000-8000-000000000101',
  '50000000-0000-4000-8000-000000000201',
  (select run_id from matrix_runs where label = 'first'), now(),
  '[{"external_listing_id":"MLA-W-1","title":"Seen again","status":"active","price":10,"currency_id":"ARS","available_quantity":1,"sold_quantity":0}]'::jsonb
);
select pg_temp.assert_true(
  (select reappeared_count = 1 from public.listing_sync_runs
   where id = (select run_id from matrix_runs where label = 'first')),
  'seen-to-seen not reappeared'
);
\echo 'F seen-to-seen idempotency: PASS'

select * from public.finalize_listing_sync_run_with_reconciliation(
  'org_220w_a', '50000000-0000-4000-8000-000000000101',
  '50000000-0000-4000-8000-000000000201',
  (select run_id from matrix_runs where label = 'first'), 'succeeded',
  1, 1, 1, 1, 0, 1, 1, true, null, null
);

select pg_temp.assert_true(
  (select reconciliation_state = 'missing_candidate' and not_seen_since is not null
    and consecutive_not_seen_count = 1 and status = 'active'
   from public.listings where id = '50000000-0000-4000-8000-000000000302'),
  'first missing transition preserves provider status'
);
select pg_temp.assert_true(
  (select reconciliation_eligible and missing_candidate_count = 1 and reappeared_count = 1
   from public.listing_sync_runs where id = (select run_id from matrix_runs where label = 'first')),
  'eligible run counters'
);
\echo 'G eligible finalize creates reversible candidate atomically: PASS'

select * from public.finalize_listing_sync_run_with_reconciliation(
  'org_220w_a', '50000000-0000-4000-8000-000000000101',
  '50000000-0000-4000-8000-000000000201',
  (select run_id from matrix_runs where label = 'first'), 'succeeded',
  1, 1, 1, 1, 0, 1, 1, true, null, null
);
select pg_temp.assert_true(
  (select consecutive_not_seen_count = 1 from public.listings where id = '50000000-0000-4000-8000-000000000302')
  and (select count(*) = 1 from public.audit_events
       where resource_id = (select run_id::text from matrix_runs where label = 'first')
         and action = 'listing.sync.succeeded'),
  'terminal retry has no repeated effects'
);
\echo 'H finalize/reconciliation idempotency: PASS'

do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220w_a', '50000000-0000-4000-8000-000000000101',
    '50000000-0000-4000-8000-000000000201', '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-9000-000000000502'
  );
  insert into matrix_runs values ('second', result.id);
end;
$$;
update public.listing_sync_runs
set started_at = clock_timestamp() + interval '1 second'
where id = (select run_id from matrix_runs where label = 'second');
select * from public.persist_listing_sync_batch_for_run(
  'org_220w_a', '50000000-0000-4000-8000-000000000101',
  '50000000-0000-4000-8000-000000000201',
  (select run_id from matrix_runs where label = 'second'), now(),
  '[{"external_listing_id":"MLA-W-1","title":"Seen again","status":"active","price":10,"currency_id":"ARS","available_quantity":1,"sold_quantity":0}]'::jsonb
);
select * from public.finalize_listing_sync_run_with_reconciliation(
  'org_220w_a', '50000000-0000-4000-8000-000000000101',
  '50000000-0000-4000-8000-000000000201',
  (select run_id from matrix_runs where label = 'second'), 'succeeded',
  1, 1, 1, 1, 0, 1, 1, true, null, null
);
select pg_temp.assert_true(
  (select consecutive_not_seen_count = 2 from public.listings where id = '50000000-0000-4000-8000-000000000302')
  and (select missing_candidate_count = 0 from public.listing_sync_runs
       where id = (select run_id from matrix_runs where label = 'second')),
  'repeated missing preserves candidate semantics'
);
\echo 'I repeated missing increments evidence, not new-candidate counter: PASS'

do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220w_a', '50000000-0000-4000-8000-000000000102',
    '50000000-0000-4000-8000-000000000202', '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-9000-000000000503'
  );
  perform * from public.finalize_listing_sync_run_with_reconciliation(
    'org_220w_a', '50000000-0000-4000-8000-000000000102',
    '50000000-0000-4000-8000-000000000202', result.id, 'partial',
    1, 1, 0, 0, 1, 1, 1, false, 'partial_item_failure', 'partial item failure'
  );
end;
$$;
select pg_temp.assert_true(
  (select reconciliation_state = 'seen' from public.listings where id = '50000000-0000-4000-8000-000000000303'),
  'partial run cannot reconcile'
);
\echo 'J partial/provider failure cannot reconcile: PASS'

do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220w_a', '50000000-0000-4000-8000-000000000102',
    '50000000-0000-4000-8000-000000000202', '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-9000-000000000505'
  );
  begin
    perform * from public.finalize_listing_sync_run_with_reconciliation(
      'org_220w_a', '50000000-0000-4000-8000-000000000102',
      '50000000-0000-4000-8000-000000000202', result.id, 'failed',
      0, 0, 0, 0, 0, 0, 0, true, 'persistence_failure', null
    );
    raise exception 'expected failed eligibility rejection';
  exception when others then
    if sqlerrm = 'expected failed eligibility rejection' then raise; end if;
  end;
  begin
    perform * from public.finalize_listing_sync_run_with_reconciliation(
      'org_220w_a', '50000000-0000-4000-8000-000000000102',
      '50000000-0000-4000-8000-000000000202', result.id, 'succeeded',
      1, 1, 0, 0, 0, 1, 1, true, null, null
    );
    raise exception 'expected counter mismatch rejection';
  exception when others then
    if sqlerrm = 'expected counter mismatch rejection' then raise; end if;
  end;
  perform * from public.finalize_listing_sync_run_with_reconciliation(
    'org_220w_a', '50000000-0000-4000-8000-000000000102',
    '50000000-0000-4000-8000-000000000202', result.id, 'failed',
    0, 0, 0, 0, 0, 0, 0, false, 'persistence_failure', null
  );
end;
$$;
select pg_temp.assert_true(
  (select reconciliation_state = 'seen' from public.listings where id = '50000000-0000-4000-8000-000000000303'),
  'failed and mismatched runs did not reconcile'
);
\echo 'J2 failed/counter-mismatch reconciliation denied: PASS'

do $$
declare result record;
begin
  select * into result from public.start_listing_sync_run(
    'org_220w_a', '50000000-0000-4000-8000-000000000102',
    '50000000-0000-4000-8000-000000000202', '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-9000-000000000504'
  );
  update public.listing_sync_runs set started_at = now() - interval '30 minutes',
    last_checkpoint_at = now() - interval '20 minutes', discovered_count = 1,
    requested_count = 1, fetched_count = 1, persisted_count = 1,
    pages_count = 1, batches_count = 1 where id = result.id;
  perform * from public.recover_stale_listing_sync_run(
    'org_220w_a', result.id, '50000000-0000-4000-8000-000000000001',
    'succeeded', 'FINALIZE_INTERRUPTED', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(
    (select not reconciliation_eligible from public.listing_sync_runs where id = result.id),
    'recovered run remains ineligible'
  );
end;
$$;
select pg_temp.assert_true(
  (select reconciliation_state = 'seen' from public.listings where id = '50000000-0000-4000-8000-000000000303'),
  'recovery did not reconcile'
);
\echo 'K administrative stale recovery cannot reconcile: PASS'

do $$
declare old_run uuid := '50000000-0000-4000-8000-000000000601';
begin
  insert into public.listing_sync_runs (
    id, organization_id, store_id, connection_id, actor_membership_id, kind,
    idempotency_key, status, started_at, last_checkpoint_at
  ) values (
    old_run, 'org_220w_a', '50000000-0000-4000-8000-000000000101',
    '50000000-0000-4000-8000-000000000204', '50000000-0000-4000-8000-000000000001',
    'listing_backfill', '50000000-0000-4000-9000-000000000601', 'running',
    now() - interval '2 hours', now() - interval '2 hours'
  );
  insert into public.listing_sync_runs (
    id, organization_id, store_id, connection_id, actor_membership_id, kind,
    idempotency_key, status, started_at, completed_at
  ) values (
    '50000000-0000-4000-8000-000000000602', 'org_220w_a',
    '50000000-0000-4000-8000-000000000101', '50000000-0000-4000-8000-000000000204',
    '50000000-0000-4000-8000-000000000001', 'listing_backfill',
    '50000000-0000-4000-9000-000000000602', 'succeeded', now() - interval '1 hour', now()
  );
  insert into public.listings (
    organization_id, store_id, connection_id, external_listing_id, title, status,
    last_synced_at, last_seen_sync_run_id
  ) values (
    'org_220w_a', '50000000-0000-4000-8000-000000000101',
    '50000000-0000-4000-8000-000000000204', 'MLA-W-OLD', 'New evidence', 'active',
    now(), '50000000-0000-4000-8000-000000000602'
  );
  begin
    perform * from public.finalize_listing_sync_run_with_reconciliation(
      'org_220w_a', '50000000-0000-4000-8000-000000000101',
      '50000000-0000-4000-8000-000000000204', old_run, 'succeeded',
      0, 0, 0, 0, 0, 1, 0, true, null, null
    );
    raise exception 'expected old run rejection';
  exception when others then
    if sqlerrm = 'expected old run rejection' then raise; end if;
  end;
end;
$$;
select pg_temp.assert_true(
  (select reconciliation_state = 'seen' and last_seen_sync_run_id = '50000000-0000-4000-8000-000000000602'
   from public.listings where external_listing_id = 'MLA-W-OLD'),
  'newer positive evidence preserved'
);
\echo 'L old-run protection: PASS'

do $$
begin
  begin
    perform * from public.finalize_listing_sync_run_with_reconciliation(
      'org_220w_b', '50000000-0000-4000-8000-000000000103',
      '50000000-0000-4000-8000-000000000203',
      (select run_id from matrix_runs where label = 'second'), 'succeeded',
      1, 1, 1, 1, 0, 1, 1, true, null, null
    );
    raise exception 'expected tenant rejection';
  exception when others then
    if sqlerrm = 'expected tenant rejection' then raise; end if;
  end;
end;
$$;
\echo 'M cross-tenant finalize: PASS'

rollback;

\echo 'MATRIX 14/14 PASS'
