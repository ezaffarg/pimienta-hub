alter table public.integration_event_maintenance_runs
  drop constraint integration_event_maintenance_runs_error_code_check;

alter table public.integration_event_maintenance_runs
  add constraint integration_event_maintenance_runs_error_code_check check (
    error_code is null or error_code in (
      'event_processing_failed',
      'missed_feed_failed',
      'maintenance_stale_reclaimed'
    )
  );

alter table public.integration_event_maintenance_runs
  drop constraint integration_event_maintenance_runs_error_summary_check;

alter table public.integration_event_maintenance_runs
  add constraint integration_event_maintenance_runs_error_summary_check check (
    error_summary is null or error_summary in (
      'One or more integration events could not be processed',
      'Missed feeds recovery failed safely',
      'Maintenance run was reclaimed after becoming stale'
    )
  );

create function public.checkpoint_integration_event_maintenance_run(
  p_run_id uuid,
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
  p_last_missed_feed_check_at timestamptz
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
    or (p_missed_feed_offset is not null and p_missed_feed_offset < 0) then
    raise exception 'integration_event_maintenance_checkpoint_invalid';
  end if;

  select r.* into current_run
  from public.integration_event_maintenance_runs as r
  where r.id = p_run_id
  for update;

  if current_run.id is null then return 'not_found'; end if;
  if current_run.status <> 'running' then return 'already_terminal'; end if;

  if p_received_selected < current_run.received_selected_count
    or p_retry_selected < current_run.retry_selected_count
    or p_processed < current_run.processed_count
    or p_stale_noop < current_run.stale_noop_count
    or p_equivalent_noop < current_run.equivalent_noop_count
    or p_retry_scheduled < current_run.retry_scheduled_count
    or p_retry_exhausted < current_run.retry_exhausted_count
    or p_failed_permanent < current_run.failed_permanent_count
    or p_skipped < current_run.skipped_count
    or p_missed_feed_accepted < current_run.missed_feed_accepted_count
    or p_missed_feed_duplicate < current_run.missed_feed_duplicate_count
    or p_missed_feed_pages < current_run.missed_feed_pages_count then
    raise exception 'integration_event_maintenance_checkpoint_regression';
  end if;

  update public.integration_event_maintenance_runs as r
  set last_checkpoint_at = now(),
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
      missed_feed_offset = case
        when current_run.missed_feed_due then p_missed_feed_offset
        else current_run.missed_feed_offset
      end,
      last_missed_feed_check_at = case
        when current_run.missed_feed_due and p_last_missed_feed_check_at is not null
          then p_last_missed_feed_check_at
        else current_run.last_missed_feed_check_at
      end,
      updated_at = now()
  where r.id = current_run.id;

  return 'checkpointed';
end;
$$;

create function public.reclaim_stale_integration_event_maintenance_run(
  p_run_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_run public.integration_event_maintenance_runs%rowtype;
begin
  if p_run_id is null then
    raise exception 'integration_event_maintenance_reclaim_invalid';
  end if;

  select r.* into current_run
  from public.integration_event_maintenance_runs as r
  where r.id = p_run_id
  for update;

  if current_run.id is null then return 'not_found'; end if;
  if current_run.status <> 'running' then return 'already_terminal'; end if;
  if current_run.last_checkpoint_at > now() - interval '10 minutes' then
    return 'not_stale';
  end if;

  update public.integration_event_maintenance_runs as r
  set status = 'failed',
      completed_at = now(),
      error_code = 'maintenance_stale_reclaimed',
      error_summary = 'Maintenance run was reclaimed after becoming stale',
      updated_at = now()
  where r.id = current_run.id and r.status = 'running';

  if not found then return 'already_terminal'; end if;
  return 'reclaimed';
end;
$$;

revoke all on function public.checkpoint_integration_event_maintenance_run(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.reclaim_stale_integration_event_maintenance_run(uuid)
  from public, anon, authenticated;

grant execute on function public.checkpoint_integration_event_maintenance_run(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz
) to service_role;
grant execute on function public.reclaim_stale_integration_event_maintenance_run(uuid)
  to service_role;

comment on function public.checkpoint_integration_event_maintenance_run(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz
) is 'Monotonic progress checkpoint for a running integration event maintenance run.';
comment on function public.reclaim_stale_integration_event_maintenance_run(uuid) is
  'Atomically fails a maintenance run with no checkpoint for ten minutes; no event work.';
