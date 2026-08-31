\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception '2.20X-F assertion failed: %', message; end if;
end;
$$;

insert into public.stores (id, organization_id, name, status) values
  ('90000000-0000-4000-8000-000000000101', 'org_220x_f', 'Store X-F', 'active'),
  ('90000000-0000-4000-8000-000000000102', 'org_220x_other', 'Other Store', 'active');

insert into public.connections (
  id, organization_id, store_id, provider, external_account_id, status
) values
  ('90000000-0000-4000-8000-000000000201', 'org_220x_f',
   '90000000-0000-4000-8000-000000000101', 'mercado-libre', '123', 'active'),
  ('90000000-0000-4000-8000-000000000202', 'org_220x_other',
   '90000000-0000-4000-8000-000000000102', 'mercado-libre', '999', 'active'),
  ('90000000-0000-4000-8000-000000000203', 'org_220x_f',
   '90000000-0000-4000-8000-000000000101', 'mercado-libre', null, 'disabled');

insert into public.integration_events (
  id, organization_id, store_id, connection_id, provider, topic, resource,
  external_resource_id, dedupe_key, provider_user_id, application_id,
  provider_sent_at, delivery_attempts
) values
  ('90000000-0000-4000-8000-000000000001', 'org_220x_f',
   '90000000-0000-4000-8000-000000000101', '90000000-0000-4000-8000-000000000201',
   'mercado-libre', 'items', '/items/MLA101', 'MLA101', repeat('1', 64), '123', '456', now(), 1),
  ('90000000-0000-4000-8000-000000000002', 'org_220x_f',
   '90000000-0000-4000-8000-000000000101', '90000000-0000-4000-8000-000000000201',
   'mercado-libre', 'items', '/items/MLA102', 'MLA102', repeat('2', 64), '123', '456', now(), 1),
  ('90000000-0000-4000-8000-000000000003', 'org_220x_f',
   '90000000-0000-4000-8000-000000000101', '90000000-0000-4000-8000-000000000201',
   'mercado-libre', 'items', '/items/MLA103', 'MLA103', repeat('3', 64), '123', '456', now(), 1),
  ('90000000-0000-4000-8000-000000000004', 'org_220x_other',
   '90000000-0000-4000-8000-000000000102', '90000000-0000-4000-8000-000000000202',
   'mercado-libre', 'items', '/items/MLA104', 'MLA104', repeat('4', 64), '999', '456', now(), 1),
  ('90000000-0000-4000-8000-000000000005', 'org_220x_f',
   '90000000-0000-4000-8000-000000000101', '90000000-0000-4000-8000-000000000201',
   'mercado-libre', 'items', '/items/MLA105', 'MLA105', repeat('5', 64), '123', '456', now(), 1);

select pg_temp.assert_true(
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'integration_event_maintenance_runs'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'integration_event_maintenance_runs'
      and column_name = 'run_number' and is_identity = 'YES'
  )
  and (select relrowsecurity from pg_class
       where oid = 'public.integration_event_maintenance_runs'::regclass)
  and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'integration_event_maintenance_runs'
  ),
  'maintenance table and deny-by-default RLS'
);
\echo 'A schema and RLS: PASS'

select pg_temp.assert_true(
  (select array_agg(connection_id order by connection_id) = array[
    '90000000-0000-4000-8000-000000000201'::uuid,
    '90000000-0000-4000-8000-000000000202'::uuid
  ] from public.list_integration_event_maintenance_connections(10)
     where connection_id in (
       '90000000-0000-4000-8000-000000000201'::uuid,
       '90000000-0000-4000-8000-000000000202'::uuid,
       '90000000-0000-4000-8000-000000000203'::uuid
     )),
  'only active Mercado Libre Connections with identity are candidates'
);
\echo 'B bounded Connection candidates: PASS'

do $$
declare first_start record;
declare second_start record;
begin
  select * into first_start from public.start_integration_event_maintenance_run(
    '90000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  select * into second_start from public.start_integration_event_maintenance_run(
    '90000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(
    first_start.outcome = 'started'
      and first_start.organization_id = 'org_220x_f'
      and first_start.store_id = '90000000-0000-4000-8000-000000000101'
      and first_start.missed_feed_due is true
      and first_start.missed_feed_offset is null
      and second_start.outcome = 'already_running'
      and second_start.run_id = first_start.run_id
      and (select count(*) = 1 from public.integration_event_maintenance_runs
           where connection_id = '90000000-0000-4000-8000-000000000201'
             and status = 'running'),
    'tenant-derived start and single running lock'
  );
end;
$$;
\echo 'C start scope and concurrent lock: PASS'

do $$
begin
  perform * from public.claim_integration_event_processing(
    '90000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002'
  );
  perform public.fail_integration_event_processing(
    '90000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    'provider_timeout', 'Provider request timed out', true, null
  );
  update public.integration_events set next_retry_at = now() - interval '1 second'
  where id = '90000000-0000-4000-8000-000000000002';

  perform * from public.claim_integration_event_processing(
    '90000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000003'
  );
  perform public.fail_integration_event_processing(
    '90000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000003',
    'provider_timeout', 'Provider request timed out', true, now() + interval '1 hour'
  );

  perform * from public.claim_integration_event_processing(
    '90000000-0000-4000-8000-000000000005',
    '91000000-0000-4000-8000-000000000005'
  );
end;
$$;

select pg_temp.assert_true(
  (select array_agg(event_id) = array['90000000-0000-4000-8000-000000000001'::uuid]
   from public.list_received_integration_events_for_connection(
     '90000000-0000-4000-8000-000000000201', 10
   )),
  'received selector is Connection-scoped and excludes processing/failed'
);
\echo 'D received selector: PASS'

select pg_temp.assert_true(
  (select array_agg(event_id) = array['90000000-0000-4000-8000-000000000002'::uuid]
   from public.list_due_integration_event_retries_for_connection(
     '90000000-0000-4000-8000-000000000201', 10
   )),
  'retry selector excludes not-due and leased events'
);
\echo 'E retry selector: PASS'

do $$
declare current_run uuid;
declare outcome text;
declare next_start record;
declare cadence_start record;
begin
  select id into current_run from public.integration_event_maintenance_runs
  where connection_id = '90000000-0000-4000-8000-000000000201' and status = 'running';
  select public.finalize_integration_event_maintenance_run(
    current_run, 'succeeded',
    1, 1, 1, 0, 0, 1, 0, 0, 0, 2, 1, 1,
    20, now(), null, null
  ) into outcome;
  select * into next_start from public.start_integration_event_maintenance_run(
    '90000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(
    outcome = 'finalized'
      and next_start.outcome = 'started'
      and next_start.missed_feed_due is true
      and next_start.missed_feed_offset = 20,
    'finalize counters and durable continuation'
  );
  perform public.finalize_integration_event_maintenance_run(
    next_start.run_id, 'succeeded',
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    null, now(), null, null
  );
  select * into cadence_start from public.start_integration_event_maintenance_run(
    '90000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(
    cadence_start.outcome = 'started'
      and cadence_start.missed_feed_due is false
      and cadence_start.missed_feed_offset is null,
    'completed feed respects cadence'
  );
end;
$$;
\echo 'F finalize, continuation and cadence: PASS'

select pg_temp.assert_true(
  (select received_backlog = 1 and retry_due = 1 and processing = 1
     and last_run_id is not null and last_run_status = 'running'
   from public.get_integration_event_operations_summary('org_220x_f'))
  and
  (select received_backlog = 1 and retry_due = 0
   from public.get_integration_event_operations_summary('org_220x_other')),
  'summary is tenant-bound and uses safe aggregates'
);
\echo 'G tenant summary: PASS'

select pg_temp.assert_true(
  not has_table_privilege('public', 'public.integration_event_maintenance_runs', 'SELECT')
  and not has_table_privilege('anon', 'public.integration_event_maintenance_runs', 'SELECT')
  and not has_table_privilege('authenticated', 'public.integration_event_maintenance_runs', 'SELECT')
  and has_table_privilege('service_role', 'public.integration_event_maintenance_runs', 'SELECT')
  and not has_function_privilege(
    'public', 'public.start_integration_event_maintenance_run(uuid,timestamp with time zone)', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.start_integration_event_maintenance_run(uuid,timestamp with time zone)', 'EXECUTE'
  ),
  'maintenance grants are service-role only'
);
\echo 'H service-only grants: PASS'

rollback;
