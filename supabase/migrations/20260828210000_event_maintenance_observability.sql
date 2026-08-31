create table public.integration_event_maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  run_number bigint generated always as identity unique,
  organization_id text not null,
  store_id uuid not null,
  connection_id uuid not null,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_checkpoint_at timestamptz not null default now(),
  missed_feed_due boolean not null,
  missed_feed_offset integer check (missed_feed_offset is null or missed_feed_offset >= 0),
  last_missed_feed_check_at timestamptz,
  received_selected_count integer not null default 0 check (received_selected_count >= 0),
  retry_selected_count integer not null default 0 check (retry_selected_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  stale_noop_count integer not null default 0 check (stale_noop_count >= 0),
  equivalent_noop_count integer not null default 0 check (equivalent_noop_count >= 0),
  retry_scheduled_count integer not null default 0 check (retry_scheduled_count >= 0),
  retry_exhausted_count integer not null default 0 check (retry_exhausted_count >= 0),
  failed_permanent_count integer not null default 0 check (failed_permanent_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  missed_feed_accepted_count integer not null default 0 check (missed_feed_accepted_count >= 0),
  missed_feed_duplicate_count integer not null default 0 check (missed_feed_duplicate_count >= 0),
  missed_feed_pages_count integer not null default 0 check (missed_feed_pages_count >= 0),
  connections_checked_count integer not null default 1 check (connections_checked_count = 1),
  error_code text check (
    error_code is null or error_code in (
      'event_processing_failed',
      'missed_feed_failed'
    )
  ),
  error_summary text check (
    error_summary is null or error_summary in (
      'One or more integration events could not be processed',
      'Missed feeds recovery failed safely'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_event_maintenance_connection_fk
    foreign key (connection_id, store_id, organization_id)
    references public.connections (id, store_id, organization_id),
  constraint integration_event_maintenance_lifecycle_check check (
    (status = 'running' and completed_at is null and error_code is null and error_summary is null)
    or
    (status = 'succeeded' and completed_at is not null and error_code is null and error_summary is null)
    or
    (status in ('partial', 'failed') and completed_at is not null
      and error_code is not null and error_summary is not null)
  )
);

create unique index integration_event_maintenance_single_running_idx
  on public.integration_event_maintenance_runs (connection_id)
  where status = 'running';

create index integration_event_maintenance_tenant_recent_idx
  on public.integration_event_maintenance_runs (organization_id, started_at desc, id desc);

alter table public.integration_event_maintenance_runs enable row level security;
revoke all on table public.integration_event_maintenance_runs from public, anon, authenticated;
grant select, insert, update on table public.integration_event_maintenance_runs to service_role;
revoke all on sequence public.integration_event_maintenance_runs_run_number_seq
  from public, anon, authenticated;
grant usage, select on sequence public.integration_event_maintenance_runs_run_number_seq
  to service_role;

create function public.list_integration_event_maintenance_connections(
  p_limit integer
)
returns table(connection_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'integration_event_maintenance_limit_invalid';
  end if;

  return query
  select c.id
  from public.connections as c
  left join lateral (
    select r.run_number
    from public.integration_event_maintenance_runs as r
    where r.connection_id = c.id
    order by r.run_number desc
    limit 1
  ) as latest on true
  where c.provider = 'mercado-libre'
    and c.status = 'active'
    and c.external_account_id is not null
  order by latest.run_number asc nulls first, c.id asc
  limit p_limit;
end;
$$;

create function public.start_integration_event_maintenance_run(
  p_connection_id uuid,
  p_missed_feed_due_before timestamptz
)
returns table(
  outcome text,
  run_id uuid,
  organization_id text,
  store_id uuid,
  connection_id uuid,
  missed_feed_due boolean,
  missed_feed_offset integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_connection public.connections%rowtype;
  existing_run public.integration_event_maintenance_runs%rowtype;
  previous_run public.integration_event_maintenance_runs%rowtype;
  created_run public.integration_event_maintenance_runs%rowtype;
  should_check_missed_feed boolean;
  continuation_offset integer;
begin
  if p_connection_id is null or p_missed_feed_due_before is null then
    raise exception 'integration_event_maintenance_start_invalid';
  end if;

  select c.* into current_connection
  from public.connections as c
  where c.id = p_connection_id
  for update;

  if current_connection.id is null
    or current_connection.provider <> 'mercado-libre'
    or current_connection.status <> 'active'
    or current_connection.external_account_id is null then
    return query select 'not_eligible'::text, null::uuid, null::text,
      null::uuid, p_connection_id, false, null::integer;
    return;
  end if;

  select r.* into existing_run
  from public.integration_event_maintenance_runs as r
  where r.connection_id = current_connection.id and r.status = 'running'
  limit 1;

  if existing_run.id is not null then
    return query select 'already_running'::text, existing_run.id,
      existing_run.organization_id, existing_run.store_id, existing_run.connection_id,
      existing_run.missed_feed_due, existing_run.missed_feed_offset;
    return;
  end if;

  select r.* into previous_run
  from public.integration_event_maintenance_runs as r
  where r.connection_id = current_connection.id and r.status <> 'running'
  order by r.run_number desc
  limit 1;

  continuation_offset := previous_run.missed_feed_offset;
  should_check_missed_feed := continuation_offset is not null
    or previous_run.id is null
    or previous_run.last_missed_feed_check_at is null
    or previous_run.last_missed_feed_check_at <= p_missed_feed_due_before;

  insert into public.integration_event_maintenance_runs (
    organization_id, store_id, connection_id, missed_feed_due, missed_feed_offset,
    last_missed_feed_check_at
  ) values (
    current_connection.organization_id, current_connection.store_id,
    current_connection.id, should_check_missed_feed,
    case when should_check_missed_feed then continuation_offset else null end,
    previous_run.last_missed_feed_check_at
  )
  returning * into created_run;

  return query select 'started'::text, created_run.id, created_run.organization_id,
    created_run.store_id, created_run.connection_id, created_run.missed_feed_due,
    created_run.missed_feed_offset;
end;
$$;

create function public.finalize_integration_event_maintenance_run(
  p_run_id uuid,
  p_status text,
  p_received_selected integer,
  p_retry_selected integer,
  p_processed integer,
  p_stale_noop integer,
  p_equivalent_noop integer,
  p_retry_scheduled integer,
  p_retry_exhausted integer,
  p_failed_permanent integer,
  p_skipped integer,
  p_missed_feed_accepted integer,
  p_missed_feed_duplicate integer,
  p_missed_feed_pages integer,
  p_missed_feed_offset integer,
  p_last_missed_feed_check_at timestamptz,
  p_error_code text,
  p_error_summary text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_run public.integration_event_maintenance_runs%rowtype;
begin
  if p_run_id is null
    or p_status not in ('succeeded', 'partial', 'failed')
    or p_received_selected is null or p_received_selected < 0
    or p_retry_selected is null or p_retry_selected < 0
    or p_processed is null or p_processed < 0
    or p_stale_noop is null or p_stale_noop < 0
    or p_equivalent_noop is null or p_equivalent_noop < 0
    or p_retry_scheduled is null or p_retry_scheduled < 0
    or p_retry_exhausted is null or p_retry_exhausted < 0
    or p_failed_permanent is null or p_failed_permanent < 0
    or p_skipped is null or p_skipped < 0
    or p_missed_feed_accepted is null or p_missed_feed_accepted < 0
    or p_missed_feed_duplicate is null or p_missed_feed_duplicate < 0
    or p_missed_feed_pages is null or p_missed_feed_pages < 0
    or p_missed_feed_offset is not null and p_missed_feed_offset < 0
    or (p_status = 'succeeded' and (p_error_code is not null or p_error_summary is not null))
    or (p_status in ('partial', 'failed') and (p_error_code is null or p_error_summary is null)) then
    raise exception 'integration_event_maintenance_finalize_invalid';
  end if;

  select r.* into current_run
  from public.integration_event_maintenance_runs as r
  where r.id = p_run_id
  for update;

  if current_run.id is null then return 'not_found'; end if;
  if current_run.status <> 'running' then return 'already_terminal'; end if;

  update public.integration_event_maintenance_runs as r
  set status = p_status,
      completed_at = now(),
      last_checkpoint_at = now(),
      missed_feed_offset = case
        when current_run.missed_feed_due then p_missed_feed_offset
        else current_run.missed_feed_offset
      end,
      last_missed_feed_check_at = case
        when current_run.missed_feed_due then p_last_missed_feed_check_at
        else current_run.last_missed_feed_check_at
      end,
      received_selected_count = p_received_selected,
      retry_selected_count = p_retry_selected,
      processed_count = p_processed,
      stale_noop_count = p_stale_noop,
      equivalent_noop_count = p_equivalent_noop,
      retry_scheduled_count = p_retry_scheduled,
      retry_exhausted_count = p_retry_exhausted,
      failed_permanent_count = p_failed_permanent,
      skipped_count = p_skipped,
      missed_feed_accepted_count = p_missed_feed_accepted,
      missed_feed_duplicate_count = p_missed_feed_duplicate,
      missed_feed_pages_count = p_missed_feed_pages,
      error_code = p_error_code,
      error_summary = p_error_summary,
      updated_at = now()
  where r.id = current_run.id;

  return 'finalized';
end;
$$;

create function public.list_received_integration_events_for_connection(
  p_connection_id uuid,
  p_limit integer
)
returns table(event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_connection_id is null or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'integration_event_received_limit_invalid';
  end if;

  return query
  select e.id
  from public.integration_events as e
  join public.connections as c
    on c.id = e.connection_id
   and c.organization_id = e.organization_id
   and c.store_id = e.store_id
   and c.provider = e.provider
   and c.external_account_id = e.provider_user_id
   and c.status = 'active'
  where e.connection_id = p_connection_id and e.status = 'received'
  order by e.received_at asc, e.id asc
  limit p_limit;
end;
$$;

create function public.list_due_integration_event_retries_for_connection(
  p_connection_id uuid,
  p_limit integer
)
returns table(event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_connection_id is null or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'integration_event_retry_limit_invalid';
  end if;

  return query
  select e.id
  from public.integration_events as e
  join public.connections as c
    on c.id = e.connection_id
   and c.organization_id = e.organization_id
   and c.store_id = e.store_id
   and c.provider = e.provider
   and c.external_account_id = e.provider_user_id
   and c.status = 'active'
  where e.connection_id = p_connection_id
    and e.status = 'failed'
    and e.retryable is true
    and e.processing_attempts < 5
    and e.next_retry_at <= now()
    and e.processing_lease_id is null
    and e.processing_lease_expires_at is null
  order by e.next_retry_at asc, e.id asc
  limit p_limit;
end;
$$;

create function public.get_integration_event_operations_summary(
  p_organization_id text
)
returns table(
  received_backlog bigint,
  retry_due bigint,
  processing bigint,
  processed_recent bigint,
  failed bigint,
  retry_exhausted bigint,
  last_run_id uuid,
  last_run_status text,
  last_run_error_code text,
  last_run_started_at timestamptz,
  last_run_completed_at timestamptz,
  last_missed_feed_check_at timestamptz,
  last_run_received_selected integer,
  last_run_retry_selected integer,
  last_run_processed integer,
  last_run_failed integer,
  last_run_missed_feed_accepted integer,
  last_run_missed_feed_duplicate integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_organization_id is null or btrim(p_organization_id) = '' then
    raise exception 'integration_event_operations_scope_invalid';
  end if;

  return query
  with event_counts as (
    select
      count(*) filter (where e.status = 'received') as received_backlog,
      count(*) filter (where e.status = 'failed' and e.retryable is true
        and e.next_retry_at <= now()) as retry_due,
      count(*) filter (where e.status = 'processing') as processing,
      count(*) filter (where e.status = 'processed'
        and e.processed_at >= now() - interval '24 hours') as processed_recent,
      count(*) filter (where e.status = 'failed') as failed,
      count(*) filter (where e.safe_error_code = 'retry_exhausted') as retry_exhausted
    from public.integration_events as e
    where e.organization_id = p_organization_id
  ), latest as (
    select r.*
    from public.integration_event_maintenance_runs as r
    where r.organization_id = p_organization_id
    order by r.run_number desc
    limit 1
  ), feed_check as (
    select max(r.last_missed_feed_check_at) as checked_at
    from public.integration_event_maintenance_runs as r
    where r.organization_id = p_organization_id
  )
  select counts.received_backlog, counts.retry_due, counts.processing,
    counts.processed_recent, counts.failed, counts.retry_exhausted,
    latest.id, latest.status, latest.error_code, latest.started_at, latest.completed_at,
    feed_check.checked_at, latest.received_selected_count,
    latest.retry_selected_count, latest.processed_count,
    latest.failed_permanent_count + latest.retry_exhausted_count,
    latest.missed_feed_accepted_count, latest.missed_feed_duplicate_count
  from event_counts as counts
  left join latest on true
  cross join feed_check;
end;
$$;

revoke all on function public.list_integration_event_maintenance_connections(integer)
  from public, anon, authenticated;
revoke all on function public.start_integration_event_maintenance_run(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.finalize_integration_event_maintenance_run(
  uuid, text, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz, text, text
) from public, anon, authenticated;
revoke all on function public.list_received_integration_events_for_connection(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.list_due_integration_event_retries_for_connection(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.get_integration_event_operations_summary(text)
  from public, anon, authenticated;

grant execute on function public.list_integration_event_maintenance_connections(integer)
  to service_role;
grant execute on function public.start_integration_event_maintenance_run(uuid, timestamptz)
  to service_role;
grant execute on function public.finalize_integration_event_maintenance_run(
  uuid, text, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz, text, text
) to service_role;
grant execute on function public.list_received_integration_events_for_connection(uuid, integer)
  to service_role;
grant execute on function public.list_due_integration_event_retries_for_connection(uuid, integer)
  to service_role;
grant execute on function public.get_integration_event_operations_summary(text)
  to service_role;

comment on table public.integration_event_maintenance_runs is
  'Bounded per-Connection event maintenance runs. No scheduler or provider payloads.';
