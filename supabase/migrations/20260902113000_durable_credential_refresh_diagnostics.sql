alter table public.integration_event_maintenance_runs
  add column credential_refresh_failure_stage text,
  add column credential_refresh_cas_failure text,
  add column credential_refresh_calls_attempted_count integer,
  add column credential_refresh_calls_succeeded_count integer;

alter table public.integration_event_maintenance_runs
  alter column credential_refresh_calls_attempted_count set default 0,
  alter column credential_refresh_calls_succeeded_count set default 0,
  add constraint integration_event_maintenance_credential_refresh_stage_check check (
    credential_refresh_failure_stage is null or credential_refresh_failure_stage in (
      'refresh_credential_read',
      'refresh_credential_decrypt',
      'refresh_lease',
      'refresh_post_claim_validation',
      'refresh_provider_request',
      'refresh_provider_response',
      'refresh_response_validation',
      'refresh_encrypt',
      'refresh_cas',
      'refresh_post_persist_validation'
    )
  ),
  add constraint integration_event_maintenance_credential_refresh_cas_check check (
    credential_refresh_cas_failure is null or (
      credential_refresh_failure_stage = 'refresh_cas'
      and credential_refresh_cas_failure in (
        'CAS_RPC_THROW', 'CAS_RPC_ERROR', 'CAS_RESPONSE_INVALID', 'CAS_CONFLICT'
      )
    )
  ),
  add constraint integration_event_maintenance_credential_refresh_calls_check check (
    (
      credential_refresh_calls_attempted_count is null
      and credential_refresh_calls_succeeded_count is null
    ) or (
      credential_refresh_calls_attempted_count >= 0
      and credential_refresh_calls_succeeded_count >= 0
      and credential_refresh_calls_succeeded_count <= credential_refresh_calls_attempted_count
    )
  ),
  add constraint integration_event_maintenance_credential_refresh_context_check check (
    credential_refresh_failure_stage is null
    or missed_feed_failure_stage = 'credential_resolution'
  );

drop function public.finalize_integration_event_maintenance_run(
  uuid, text, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz, text, text,
  text, integer, integer
);

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
  p_error_summary text,
  p_missed_feed_failure_stage text default null,
  p_provider_calls_attempted integer default 0,
  p_provider_calls_succeeded integer default 0,
  p_credential_refresh_failure_stage text default null,
  p_credential_refresh_cas_failure text default null,
  p_credential_refresh_calls_attempted integer default 0,
  p_credential_refresh_calls_succeeded integer default 0
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
    or p_provider_calls_attempted is null or p_provider_calls_attempted < 0
    or p_provider_calls_succeeded is null or p_provider_calls_succeeded < 0
    or p_provider_calls_succeeded > p_provider_calls_attempted
    or p_credential_refresh_calls_attempted is null
    or p_credential_refresh_calls_attempted < 0
    or p_credential_refresh_calls_succeeded is null
    or p_credential_refresh_calls_succeeded < 0
    or p_credential_refresh_calls_succeeded > p_credential_refresh_calls_attempted
    or p_missed_feed_failure_stage is not null and p_missed_feed_failure_stage not in (
      'connection_resolution', 'credential_resolution', 'identity_request',
      'identity_validation', 'configuration', 'missed_feed_request',
      'missed_feed_response', 'missed_feed_pagination', 'event_intake', 'other'
    )
    or p_credential_refresh_failure_stage is not null
      and p_credential_refresh_failure_stage not in (
        'refresh_credential_read', 'refresh_credential_decrypt', 'refresh_lease',
        'refresh_post_claim_validation', 'refresh_provider_request',
        'refresh_provider_response', 'refresh_response_validation', 'refresh_encrypt',
        'refresh_cas', 'refresh_post_persist_validation'
      )
    or p_credential_refresh_cas_failure is not null and (
      p_credential_refresh_failure_stage <> 'refresh_cas'
      or p_credential_refresh_cas_failure not in (
        'CAS_RPC_THROW', 'CAS_RPC_ERROR', 'CAS_RESPONSE_INVALID', 'CAS_CONFLICT'
      )
    )
    or p_credential_refresh_failure_stage is not null
      and p_missed_feed_failure_stage <> 'credential_resolution'
    or (p_status = 'succeeded' and (
      p_error_code is not null or p_error_summary is not null
      or p_missed_feed_failure_stage is not null
      or p_credential_refresh_failure_stage is not null
      or p_credential_refresh_cas_failure is not null
    ))
    or (p_status in ('partial', 'failed') and (
      p_error_code is null or p_error_summary is null
    )) then
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
      missed_feed_failure_stage = p_missed_feed_failure_stage,
      provider_calls_attempted_count = p_provider_calls_attempted,
      provider_calls_succeeded_count = p_provider_calls_succeeded,
      credential_refresh_failure_stage = p_credential_refresh_failure_stage,
      credential_refresh_cas_failure = p_credential_refresh_cas_failure,
      credential_refresh_calls_attempted_count = p_credential_refresh_calls_attempted,
      credential_refresh_calls_succeeded_count = p_credential_refresh_calls_succeeded,
      error_code = p_error_code,
      error_summary = p_error_summary,
      updated_at = now()
  where r.id = current_run.id;

  return 'finalized';
end;
$$;

drop function public.checkpoint_integration_event_maintenance_run(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz,
  text, integer, integer
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
  p_last_missed_feed_check_at timestamptz,
  p_missed_feed_failure_stage text default null,
  p_provider_calls_attempted integer default 0,
  p_provider_calls_succeeded integer default 0,
  p_credential_refresh_failure_stage text default null,
  p_credential_refresh_cas_failure text default null,
  p_credential_refresh_calls_attempted integer default 0,
  p_credential_refresh_calls_succeeded integer default 0
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
    or p_missed_feed_offset is not null and p_missed_feed_offset < 0
    or p_provider_calls_attempted is null or p_provider_calls_attempted < 0
    or p_provider_calls_succeeded is null or p_provider_calls_succeeded < 0
    or p_provider_calls_succeeded > p_provider_calls_attempted
    or p_credential_refresh_calls_attempted is null
    or p_credential_refresh_calls_attempted < 0
    or p_credential_refresh_calls_succeeded is null
    or p_credential_refresh_calls_succeeded < 0
    or p_credential_refresh_calls_succeeded > p_credential_refresh_calls_attempted
    or p_missed_feed_failure_stage is not null and p_missed_feed_failure_stage not in (
      'connection_resolution', 'credential_resolution', 'identity_request',
      'identity_validation', 'configuration', 'missed_feed_request',
      'missed_feed_response', 'missed_feed_pagination', 'event_intake', 'other'
    )
    or p_credential_refresh_failure_stage is not null
      and p_credential_refresh_failure_stage not in (
        'refresh_credential_read', 'refresh_credential_decrypt', 'refresh_lease',
        'refresh_post_claim_validation', 'refresh_provider_request',
        'refresh_provider_response', 'refresh_response_validation', 'refresh_encrypt',
        'refresh_cas', 'refresh_post_persist_validation'
      )
    or p_credential_refresh_cas_failure is not null and (
      p_credential_refresh_failure_stage <> 'refresh_cas'
      or p_credential_refresh_cas_failure not in (
        'CAS_RPC_THROW', 'CAS_RPC_ERROR', 'CAS_RESPONSE_INVALID', 'CAS_CONFLICT'
      )
    )
    or p_credential_refresh_failure_stage is not null
      and p_missed_feed_failure_stage <> 'credential_resolution' then
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
    or p_missed_feed_pages < current_run.missed_feed_pages_count
    or p_provider_calls_attempted < current_run.provider_calls_attempted_count
    or p_provider_calls_succeeded < current_run.provider_calls_succeeded_count
    or p_credential_refresh_calls_attempted
      < current_run.credential_refresh_calls_attempted_count
    or p_credential_refresh_calls_succeeded
      < current_run.credential_refresh_calls_succeeded_count then
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
      missed_feed_failure_stage = coalesce(
        p_missed_feed_failure_stage, current_run.missed_feed_failure_stage
      ),
      provider_calls_attempted_count = p_provider_calls_attempted,
      provider_calls_succeeded_count = p_provider_calls_succeeded,
      credential_refresh_failure_stage = coalesce(
        p_credential_refresh_failure_stage, current_run.credential_refresh_failure_stage
      ),
      credential_refresh_cas_failure = coalesce(
        p_credential_refresh_cas_failure, current_run.credential_refresh_cas_failure
      ),
      credential_refresh_calls_attempted_count = p_credential_refresh_calls_attempted,
      credential_refresh_calls_succeeded_count = p_credential_refresh_calls_succeeded,
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

drop function public.get_integration_event_operations_summary(text);

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
  last_run_missed_feed_duplicate integer,
  last_run_missed_feed_failure_stage text,
  last_run_provider_calls_attempted integer,
  last_run_provider_calls_succeeded integer,
  last_run_credential_refresh_failure_stage text,
  last_run_credential_refresh_cas_failure text,
  last_run_credential_refresh_calls_attempted integer,
  last_run_credential_refresh_calls_succeeded integer
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
    latest.missed_feed_accepted_count, latest.missed_feed_duplicate_count,
    latest.missed_feed_failure_stage, latest.provider_calls_attempted_count,
    latest.provider_calls_succeeded_count, latest.credential_refresh_failure_stage,
    latest.credential_refresh_cas_failure,
    latest.credential_refresh_calls_attempted_count,
    latest.credential_refresh_calls_succeeded_count
  from event_counts as counts
  left join latest on true
  cross join feed_check;
end;
$$;

revoke all on function public.finalize_integration_event_maintenance_run(
  uuid, text, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz, text, text,
  text, integer, integer, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.checkpoint_integration_event_maintenance_run(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz,
  text, integer, integer, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.get_integration_event_operations_summary(text)
  from public, anon, authenticated;

grant execute on function public.finalize_integration_event_maintenance_run(
  uuid, text, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz, text, text,
  text, integer, integer, text, text, integer, integer
) to service_role;
grant execute on function public.checkpoint_integration_event_maintenance_run(
  uuid, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz,
  text, integer, integer, text, text, integer, integer
) to service_role;
grant execute on function public.get_integration_event_operations_summary(text)
  to service_role;

comment on column public.integration_event_maintenance_runs.credential_refresh_failure_stage is
  'Safe credential refresh boundary; null means no failure or historical unknown.';
comment on column public.integration_event_maintenance_runs.credential_refresh_cas_failure is
  'Allowlisted CAS subtype when credential_refresh_failure_stage is refresh_cas.';
comment on column public.integration_event_maintenance_runs.credential_refresh_calls_attempted_count is
  'OAuth token refresh requests attempted; null means historical unknown.';
comment on column public.integration_event_maintenance_runs.credential_refresh_calls_succeeded_count is
  'OAuth token refresh responses accepted by the client boundary; null means historical unknown.';
