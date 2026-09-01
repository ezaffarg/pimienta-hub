\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception '2.20X-F3-C assertion failed: %', message; end if;
end;
$$;

insert into public.stores (id, organization_id, name, status) values
  ('93000000-0000-4000-8000-000000000101', 'org_220x_f3c', 'Store X-F3-C', 'active');

insert into public.connections (
  id, organization_id, store_id, provider, external_account_id, status
) values (
  '93000000-0000-4000-8000-000000000201', 'org_220x_f3c',
  '93000000-0000-4000-8000-000000000101', 'mercado-libre', '2303', 'active'
);

select pg_temp.assert_true(
  (select count(*) = 3 from information_schema.columns
   where table_schema = 'public' and table_name = 'integration_event_maintenance_runs'
     and column_name in (
       'missed_feed_failure_stage',
       'provider_calls_attempted_count',
       'provider_calls_succeeded_count'
     ))
  and (select column_default = '0' from information_schema.columns
       where table_schema = 'public' and table_name = 'integration_event_maintenance_runs'
         and column_name = 'provider_calls_attempted_count')
  and (select column_default = '0' from information_schema.columns
       where table_schema = 'public' and table_name = 'integration_event_maintenance_runs'
         and column_name = 'provider_calls_succeeded_count')
  and (select relrowsecurity from pg_class
       where oid = 'public.integration_event_maintenance_runs'::regclass)
  and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'integration_event_maintenance_runs'
  ),
  'additive columns, defaults and deny-by-default RLS'
);
\echo 'A schema and RLS: PASS'

select pg_temp.assert_true(
  (select count(*) = 1 from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'checkpoint_integration_event_maintenance_run'
     and prosecdef
     and proconfig @> array['search_path=pg_catalog'])
  and (select count(*) = 1 from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname = 'finalize_integration_event_maintenance_run'
         and prosecdef
         and proconfig @> array['search_path=pg_catalog'])
  and not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'checkpoint_integration_event_maintenance_run',
        'finalize_integration_event_maintenance_run'
      )
      and (
        has_function_privilege('public', oid, 'EXECUTE')
        or has_function_privilege('anon', oid, 'EXECUTE')
        or has_function_privilege('authenticated', oid, 'EXECUTE')
        or not has_function_privilege('service_role', oid, 'EXECUTE')
      )
  ),
  'single service-role-only SECURITY DEFINER RPC contracts'
);
\echo 'B RPC security: PASS'

do $$
declare started record;
declare outcome text;
begin
  select * into started from public.start_integration_event_maintenance_run(
    '93000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(
    started.outcome = 'started'
      and (select missed_feed_failure_stage is null
             and provider_calls_attempted_count = 0
             and provider_calls_succeeded_count = 0
           from public.integration_event_maintenance_runs where id = started.run_id),
    'new runs start with safe observable defaults'
  );

  select public.checkpoint_integration_event_maintenance_run(
    p_run_id => started.run_id,
    p_received_selected => 0,
    p_retry_selected => 0,
    p_processed => 0,
    p_stale_noop => 0,
    p_equivalent_noop => 0,
    p_retry_scheduled => 0,
    p_retry_exhausted => 0,
    p_failed_permanent => 0,
    p_skipped => 0,
    p_missed_feed_accepted => 0,
    p_missed_feed_duplicate => 0,
    p_missed_feed_pages => 0,
    p_missed_feed_offset => null,
    p_last_missed_feed_check_at => now(),
    p_missed_feed_failure_stage => 'identity_request',
    p_provider_calls_attempted => 1,
    p_provider_calls_succeeded => 0
  ) into outcome;
  perform pg_temp.assert_true(
    outcome = 'checkpointed'
      and (select missed_feed_failure_stage = 'identity_request'
             and provider_calls_attempted_count = 1
             and provider_calls_succeeded_count = 0
           from public.integration_event_maintenance_runs where id = started.run_id),
    'checkpoint persists safe stage and exact counters'
  );

  select public.finalize_integration_event_maintenance_run(
    p_run_id => started.run_id,
    p_status => 'failed',
    p_received_selected => 0,
    p_retry_selected => 0,
    p_processed => 0,
    p_stale_noop => 0,
    p_equivalent_noop => 0,
    p_retry_scheduled => 0,
    p_retry_exhausted => 0,
    p_failed_permanent => 0,
    p_skipped => 0,
    p_missed_feed_accepted => 0,
    p_missed_feed_duplicate => 0,
    p_missed_feed_pages => 0,
    p_missed_feed_offset => null,
    p_last_missed_feed_check_at => now(),
    p_error_code => 'missed_feed_failed',
    p_error_summary => 'Missed feeds recovery failed safely',
    p_missed_feed_failure_stage => 'identity_request',
    p_provider_calls_attempted => 1,
    p_provider_calls_succeeded => 0
  ) into outcome;
  perform pg_temp.assert_true(
    outcome = 'finalized'
      and (select status = 'failed'
             and missed_feed_failure_stage = 'identity_request'
             and provider_calls_attempted_count = 1
             and provider_calls_succeeded_count = 0
           from public.integration_event_maintenance_runs where id = started.run_id),
    'failed finalize preserves diagnostic metadata'
  );
end;
$$;
\echo 'C failure checkpoint and finalize: PASS'

select pg_temp.assert_true(
  (select last_run_status = 'failed'
     and last_run_missed_feed_failure_stage = 'identity_request'
     and last_run_provider_calls_attempted = 1
     and last_run_provider_calls_succeeded = 0
   from public.get_integration_event_operations_summary('org_220x_f3c')),
  'tenant summary exposes safe diagnostics'
);
\echo 'D summary observability: PASS'

do $$
declare started record;
declare outcome text;
begin
  select * into started from public.start_integration_event_maintenance_run(
    '93000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(
    started.outcome = 'started' and started.missed_feed_due is false,
    'failed check remains in cooldown'
  );

  select public.finalize_integration_event_maintenance_run(
    started.run_id, 'succeeded',
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    null, null, null, null
  ) into outcome;
  perform pg_temp.assert_true(
    outcome = 'finalized'
      and (select missed_feed_failure_stage is null
             and provider_calls_attempted_count = 0
             and provider_calls_succeeded_count = 0
           from public.integration_event_maintenance_runs where id = started.run_id),
    'old caller shape remains compatible and success stage is null'
  );

  update public.integration_event_maintenance_runs
  set last_missed_feed_check_at = now() - interval '16 minutes'
  where id = started.run_id;
  select * into started from public.start_integration_event_maintenance_run(
    '93000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(
    started.outcome = 'started' and started.missed_feed_due is true,
    '15-minute re-eligibility remains unchanged'
  );
end;
$$;
\echo 'E compatibility and cooldown: PASS'

insert into public.integration_event_maintenance_runs (
  organization_id, store_id, connection_id, status, completed_at,
  missed_feed_due, missed_feed_failure_stage,
  provider_calls_attempted_count, provider_calls_succeeded_count
) values (
  'org_220x_f3c', '93000000-0000-4000-8000-000000000101',
  '93000000-0000-4000-8000-000000000201', 'succeeded', now(), false,
  null, null, null
);

select pg_temp.assert_true(
  exists (
    select 1 from public.integration_event_maintenance_runs
    where organization_id = 'org_220x_f3c'
      and provider_calls_attempted_count is null
      and provider_calls_succeeded_count is null
  ),
  'historical unknown counters remain representable'
);
\echo 'F historical UNKNOWN compatibility: PASS'

rollback;
