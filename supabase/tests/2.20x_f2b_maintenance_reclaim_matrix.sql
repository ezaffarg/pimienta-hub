\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception '2.20X-F2b assertion failed: %', message; end if;
end;
$$;

insert into public.stores (id, organization_id, name, status) values
  ('92000000-0000-4000-8000-000000000101', 'org_220x_f2b', 'Store X-F2b', 'active');

insert into public.connections (
  id, organization_id, store_id, provider, external_account_id, status
) values (
  '92000000-0000-4000-8000-000000000201', 'org_220x_f2b',
  '92000000-0000-4000-8000-000000000101', 'mercado-libre', '2202', 'active'
);

insert into public.integration_events (
  id, organization_id, store_id, connection_id, provider, topic, resource,
  external_resource_id, dedupe_key, provider_user_id, application_id,
  provider_sent_at, delivery_attempts
) values (
  '92000000-0000-4000-8000-000000000001', 'org_220x_f2b',
  '92000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000201',
  'mercado-libre', 'items', '/items/MLA2202', 'MLA2202', repeat('2', 64),
  '2202', '456', now(), 1
);

select pg_temp.assert_true(
  not has_function_privilege(
    'public', 'public.reclaim_stale_integration_event_maintenance_run(uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.reclaim_stale_integration_event_maintenance_run(uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.reclaim_stale_integration_event_maintenance_run(uuid)', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.reclaim_stale_integration_event_maintenance_run(uuid)', 'EXECUTE'
  )
  and (
    select pronargs = 1
    from pg_proc
    where oid = 'public.reclaim_stale_integration_event_maintenance_run(uuid)'::regprocedure
  ),
  'reclaim is service-role only and accepts no caller cutoff'
);
\echo 'A reclaim authority: PASS'

do $$
declare started record;
declare outcome text;
begin
  select * into started from public.start_integration_event_maintenance_run(
    '92000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  select public.reclaim_stale_integration_event_maintenance_run(started.run_id) into outcome;
  perform pg_temp.assert_true(
    started.outcome = 'started'
      and outcome = 'not_stale'
      and (select status = 'running' and completed_at is null
           from public.integration_event_maintenance_runs where id = started.run_id),
    'fresh running run cannot be reclaimed'
  );
end;
$$;
\echo 'B fresh running denied: PASS'

do $$
declare current_run uuid;
declare outcome text;
begin
  select id into current_run
  from public.integration_event_maintenance_runs
  where connection_id = '92000000-0000-4000-8000-000000000201' and status = 'running';

  select public.checkpoint_integration_event_maintenance_run(
    current_run,
    3, 2, 2, 1, 0, 1, 0, 0, 1, 4, 2, 1,
    20, now()
  ) into outcome;

  perform pg_temp.assert_true(
    outcome = 'checkpointed'
      and (select received_selected_count = 3
             and retry_selected_count = 2
             and processed_count = 2
             and stale_noop_count = 1
             and retry_scheduled_count = 1
             and skipped_count = 1
             and missed_feed_accepted_count = 4
             and missed_feed_duplicate_count = 2
             and missed_feed_pages_count = 1
             and missed_feed_offset = 20
           from public.integration_event_maintenance_runs where id = current_run),
    'checkpoint persists monotonic progress and continuation'
  );
end;
$$;
\echo 'C natural checkpoint evidence: PASS'

do $$
declare current_run uuid;
declare outcome text;
declare event_snapshot jsonb;
begin
  select id into current_run
  from public.integration_event_maintenance_runs
  where connection_id = '92000000-0000-4000-8000-000000000201' and status = 'running';
  select to_jsonb(e) into event_snapshot
  from public.integration_events as e
  where e.id = '92000000-0000-4000-8000-000000000001';

  update public.integration_event_maintenance_runs
  set last_checkpoint_at = now() - interval '11 minutes'
  where id = current_run;

  select public.reclaim_stale_integration_event_maintenance_run(current_run) into outcome;
  perform pg_temp.assert_true(
    outcome = 'reclaimed'
      and (select status = 'failed'
             and completed_at is not null
             and error_code = 'maintenance_stale_reclaimed'
             and error_summary = 'Maintenance run was reclaimed after becoming stale'
             and received_selected_count = 3
             and processed_count = 2
             and missed_feed_accepted_count = 4
           from public.integration_event_maintenance_runs where id = current_run)
      and event_snapshot = (
        select to_jsonb(e) from public.integration_events as e
        where e.id = '92000000-0000-4000-8000-000000000001'
      ),
    'stale reclaim terminalizes safely, preserves counters and does not touch event'
  );
end;
$$;
\echo 'D stale reclaim and isolation: PASS'

do $$
declare reclaimed_run public.integration_event_maintenance_runs%rowtype;
declare completed_before timestamptz;
declare outcome text;
begin
  select * into reclaimed_run
  from public.integration_event_maintenance_runs
  where connection_id = '92000000-0000-4000-8000-000000000201'
    and error_code = 'maintenance_stale_reclaimed';
  completed_before := reclaimed_run.completed_at;
  select public.reclaim_stale_integration_event_maintenance_run(reclaimed_run.id) into outcome;
  perform pg_temp.assert_true(
    outcome = 'already_terminal'
      and (select completed_at = completed_before
             and received_selected_count = reclaimed_run.received_selected_count
             and processed_count = reclaimed_run.processed_count
           from public.integration_event_maintenance_runs where id = reclaimed_run.id),
    'second serialized reclaimer has no duplicate terminal effect'
  );
end;
$$;
\echo 'E concurrent/idempotent loser: PASS'

do $$
declare next_start record;
begin
  select * into next_start from public.start_integration_event_maintenance_run(
    '92000000-0000-4000-8000-000000000201', now() - interval '15 minutes'
  );
  perform pg_temp.assert_true(
    next_start.outcome = 'started'
      and (select count(*) = 1 from public.integration_event_maintenance_runs
           where connection_id = '92000000-0000-4000-8000-000000000201'
             and status = 'running'),
    'reclaim releases single-running gate'
  );
end;
$$;
\echo 'F next start after reclaim: PASS'

select pg_temp.assert_true(
  (select last_run_status = 'running'
     from public.get_integration_event_operations_summary('org_220x_f2b'))
  and exists (
    select 1 from public.integration_event_maintenance_runs
    where organization_id = 'org_220x_f2b'
      and error_code = 'maintenance_stale_reclaimed'
  ),
  'safe reclaim code remains available in maintenance history'
);
\echo 'G safe observability: PASS'

select pg_temp.assert_true(
  (select count(*) = 0 from public.listings
   where organization_id = 'org_220x_f2b')
  and (select status = 'received' and processing_lease_id is null
       from public.integration_events
       where id = '92000000-0000-4000-8000-000000000001'),
  'reclaim performs no Listing or event-processing writes'
);
\echo 'H no business side effects: PASS'

rollback;
