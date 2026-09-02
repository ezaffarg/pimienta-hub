\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception '2.20X-F3-C-2D3C14 assertion failed: %', message;
  end if;
end;
$$;

insert into public.stores (id, organization_id, name, status) values
  ('94000000-0000-4000-8000-000000000101', 'org_220x_f3c14', 'Store X-F3-C14', 'active');

insert into public.connections (
  id, organization_id, store_id, provider, external_account_id, status
) values (
  '94000000-0000-4000-8000-000000000201', 'org_220x_f3c14',
  '94000000-0000-4000-8000-000000000101', 'mercado-libre', '2314', 'active'
);

select pg_temp.assert_true(
  (select count(*) = 4 from information_schema.columns
   where table_schema = 'public' and table_name = 'integration_event_maintenance_runs'
     and column_name in (
       'credential_refresh_failure_stage',
       'credential_refresh_cas_failure',
       'credential_refresh_calls_attempted_count',
       'credential_refresh_calls_succeeded_count'
     ))
  and (select column_default = '0' from information_schema.columns
       where table_schema = 'public' and table_name = 'integration_event_maintenance_runs'
         and column_name = 'credential_refresh_calls_attempted_count')
  and (select column_default = '0' from information_schema.columns
       where table_schema = 'public' and table_name = 'integration_event_maintenance_runs'
         and column_name = 'credential_refresh_calls_succeeded_count'),
  'additive columns and new-run defaults'
);
\echo 'A additive schema: PASS'

select pg_temp.assert_true(
  (select count(*) = 1 from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'checkpoint_integration_event_maintenance_run'
     and prosecdef and proconfig @> array['search_path=pg_catalog'])
  and (select count(*) = 1 from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname = 'finalize_integration_event_maintenance_run'
         and prosecdef and proconfig @> array['search_path=pg_catalog'])
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

insert into public.integration_event_maintenance_runs (
  organization_id, store_id, connection_id, status, completed_at, missed_feed_due,
  credential_refresh_failure_stage, credential_refresh_cas_failure,
  credential_refresh_calls_attempted_count, credential_refresh_calls_succeeded_count
) values (
  'org_220x_f3c14', '94000000-0000-4000-8000-000000000101',
  '94000000-0000-4000-8000-000000000201', 'succeeded', now(), false,
  null, null, null, null
);

select pg_temp.assert_true(
  exists (
    select 1 from public.integration_event_maintenance_runs
    where organization_id = 'org_220x_f3c14'
      and credential_refresh_failure_stage is null
      and credential_refresh_cas_failure is null
      and credential_refresh_calls_attempted_count is null
      and credential_refresh_calls_succeeded_count is null
  ),
  'historical rows retain UNKNOWN rather than fabricated zeroes'
);
\echo 'C historical UNKNOWN: PASS'

do $$
declare started record;
declare outcome text;
begin
  select * into started from public.start_integration_event_maintenance_run(
    '94000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(
    started.outcome = 'started'
      and (select credential_refresh_failure_stage is null
             and credential_refresh_cas_failure is null
             and credential_refresh_calls_attempted_count = 0
             and credential_refresh_calls_succeeded_count = 0
           from public.integration_event_maintenance_runs where id = started.run_id),
    'new runs start with null stage and exact zero counters'
  );

  select public.checkpoint_integration_event_maintenance_run(
    p_run_id => started.run_id,
    p_received_selected => 0, p_retry_selected => 0, p_processed => 0,
    p_stale_noop => 0, p_equivalent_noop => 0, p_retry_scheduled => 0,
    p_retry_exhausted => 0, p_failed_permanent => 0, p_skipped => 0,
    p_missed_feed_accepted => 0, p_missed_feed_duplicate => 0,
    p_missed_feed_pages => 0, p_missed_feed_offset => null,
    p_last_missed_feed_check_at => now(),
    p_missed_feed_failure_stage => 'credential_resolution',
    p_provider_calls_attempted => 0, p_provider_calls_succeeded => 0,
    p_credential_refresh_failure_stage => 'refresh_cas',
    p_credential_refresh_cas_failure => 'CAS_RPC_ERROR',
    p_credential_refresh_calls_attempted => 1,
    p_credential_refresh_calls_succeeded => 1
  ) into outcome;
  perform pg_temp.assert_true(
    outcome = 'checkpointed'
      and (select credential_refresh_failure_stage = 'refresh_cas'
             and credential_refresh_cas_failure = 'CAS_RPC_ERROR'
             and credential_refresh_calls_attempted_count = 1
             and credential_refresh_calls_succeeded_count = 1
           from public.integration_event_maintenance_runs where id = started.run_id),
    'checkpoint preserves stage, CAS subtype and OAuth counters'
  );

  select public.finalize_integration_event_maintenance_run(
    p_run_id => started.run_id, p_status => 'failed',
    p_received_selected => 0, p_retry_selected => 0, p_processed => 0,
    p_stale_noop => 0, p_equivalent_noop => 0, p_retry_scheduled => 0,
    p_retry_exhausted => 0, p_failed_permanent => 0, p_skipped => 0,
    p_missed_feed_accepted => 0, p_missed_feed_duplicate => 0,
    p_missed_feed_pages => 0, p_missed_feed_offset => null,
    p_last_missed_feed_check_at => now(), p_error_code => 'missed_feed_failed',
    p_error_summary => 'Missed feeds recovery failed safely',
    p_missed_feed_failure_stage => 'credential_resolution',
    p_provider_calls_attempted => 0, p_provider_calls_succeeded => 0,
    p_credential_refresh_failure_stage => 'refresh_cas',
    p_credential_refresh_cas_failure => 'CAS_RPC_ERROR',
    p_credential_refresh_calls_attempted => 1,
    p_credential_refresh_calls_succeeded => 1
  ) into outcome;
  perform pg_temp.assert_true(
    outcome = 'finalized'
      and (select status = 'failed'
             and credential_refresh_failure_stage = 'refresh_cas'
             and credential_refresh_cas_failure = 'CAS_RPC_ERROR'
           from public.integration_event_maintenance_runs where id = started.run_id),
    'terminal failure retains safe refresh diagnostics'
  );
end;
$$;
\echo 'D checkpoint and failed finalize: PASS'

select pg_temp.assert_true(
  (select last_run_status = 'failed'
     and last_run_missed_feed_failure_stage = 'credential_resolution'
     and last_run_credential_refresh_failure_stage = 'refresh_cas'
     and last_run_credential_refresh_cas_failure = 'CAS_RPC_ERROR'
     and last_run_credential_refresh_calls_attempted = 1
     and last_run_credential_refresh_calls_succeeded = 1
   from public.get_integration_event_operations_summary('org_220x_f3c14')),
  'tenant summary exposes only safe refresh diagnostics'
);
\echo 'E summary observability: PASS'

do $$
declare started record;
declare outcome text;
begin
  select * into started from public.start_integration_event_maintenance_run(
    '94000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(started.outcome = 'started', 'second run starts');

  select public.finalize_integration_event_maintenance_run(
    p_run_id => started.run_id, p_status => 'succeeded',
    p_received_selected => 0, p_retry_selected => 0, p_processed => 0,
    p_stale_noop => 0, p_equivalent_noop => 0, p_retry_scheduled => 0,
    p_retry_exhausted => 0, p_failed_permanent => 0, p_skipped => 0,
    p_missed_feed_accepted => 0, p_missed_feed_duplicate => 0,
    p_missed_feed_pages => 0, p_missed_feed_offset => null,
    p_last_missed_feed_check_at => null, p_error_code => null, p_error_summary => null,
    p_credential_refresh_calls_attempted => 1,
    p_credential_refresh_calls_succeeded => 1
  ) into outcome;
  perform pg_temp.assert_true(
    outcome = 'finalized'
      and (select credential_refresh_failure_stage is null
             and credential_refresh_cas_failure is null
             and credential_refresh_calls_attempted_count = 1
             and credential_refresh_calls_succeeded_count = 1
           from public.integration_event_maintenance_runs where id = started.run_id),
    'successful refresh is 1/1 with null failure stage'
  );

  select * into started from public.start_integration_event_maintenance_run(
    '94000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  select public.finalize_integration_event_maintenance_run(
    started.run_id, 'succeeded',
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    null, null, null, null
  ) into outcome;
  perform pg_temp.assert_true(outcome = 'finalized', 'legacy positional caller still resolves');
end;
$$;
\echo 'F success semantics and legacy caller: PASS'

do $$
declare started record;
begin
  select * into started from public.start_integration_event_maintenance_run(
    '94000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  begin
    perform public.checkpoint_integration_event_maintenance_run(
      p_run_id => started.run_id,
      p_received_selected => 0, p_retry_selected => 0, p_processed => 0,
      p_stale_noop => 0, p_equivalent_noop => 0, p_retry_scheduled => 0,
      p_retry_exhausted => 0, p_failed_permanent => 0, p_skipped => 0,
      p_missed_feed_accepted => 0, p_missed_feed_duplicate => 0,
      p_missed_feed_pages => 0, p_missed_feed_offset => null,
      p_last_missed_feed_check_at => null,
      p_missed_feed_failure_stage => 'missed_feed_request',
      p_credential_refresh_failure_stage => 'refresh_cas',
      p_credential_refresh_cas_failure => 'CAS_CONFLICT',
      p_credential_refresh_calls_attempted => 0,
      p_credential_refresh_calls_succeeded => 1
    );
    raise exception 'invalid diagnostics were accepted';
  exception
    when others then
      if sqlerrm = 'invalid diagnostics were accepted' then raise; end if;
  end;
end;
$$;
\echo 'G invalid context and counters rejected: PASS'

rollback;
