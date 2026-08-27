-- Explicit administrative recovery for stale listing backfill runs.

alter table public.listing_sync_runs
  drop constraint listing_sync_runs_error_code_check;

alter table public.listing_sync_runs
  add constraint listing_sync_runs_error_code_check check (
    error_code is null
    or error_code in (
      'provider_rate_limited',
      'provider_timeout',
      'provider_unavailable',
      'invalid_provider_response',
      'credential_failure',
      'persistence_failure',
      'partial_item_failure',
      'administrative_recovery'
    )
  );

create function public.recover_stale_listing_sync_run(
  p_organization_id text,
  p_run_id uuid,
  p_recovery_actor_membership_id uuid,
  p_terminal_status text,
  p_recovery_reason text,
  p_stale_before timestamptz
)
returns table (
  outcome text,
  id uuid,
  organization_id text,
  store_id uuid,
  connection_id uuid,
  actor_membership_id uuid,
  kind text,
  idempotency_key uuid,
  status text,
  started_at timestamptz,
  completed_at timestamptz,
  last_checkpoint_at timestamptz,
  discovered_count bigint,
  requested_count bigint,
  fetched_count bigint,
  persisted_count bigint,
  failed_count bigint,
  pages_count bigint,
  batches_count bigint,
  error_code text,
  error_summary text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  recovery_run public.listing_sync_runs%rowtype;
  connection_provider text;
begin
  if p_terminal_status not in ('succeeded', 'failed') then
    raise exception 'listing_sync_recovery_status_invalid';
  end if;

  if p_recovery_reason not in (
    'FINALIZE_INTERRUPTED',
    'PROCESS_CRASHED',
    'MANUAL_ABORT',
    'UNKNOWN_EXECUTION_STATE'
  ) then
    raise exception 'listing_sync_recovery_reason_invalid';
  end if;

  if p_stale_before is null or p_stale_before > now() then
    raise exception 'listing_sync_recovery_threshold_invalid';
  end if;

  if not exists (
    select 1
    from public.hub_memberships as hm
    where hm.id = p_recovery_actor_membership_id
      and hm.organization_id = p_organization_id
      and hm.role in ('Owner', 'Manager')
  ) then
    raise exception 'listing_sync_recovery_actor_invalid';
  end if;

  select r.*
    into recovery_run
  from public.listing_sync_runs as r
  where r.id = p_run_id
    and r.organization_id = p_organization_id
  for update;

  if recovery_run.id is null then
    raise exception 'listing_sync_recovery_scope_invalid';
  end if;

  select c.provider
    into connection_provider
  from public.connections as c
  where c.id = recovery_run.connection_id
    and c.store_id = recovery_run.store_id
    and c.organization_id = recovery_run.organization_id
    and c.provider = 'mercado-libre';

  if connection_provider is null then
    raise exception 'listing_sync_recovery_scope_invalid';
  end if;

  if recovery_run.status <> 'running' then
    return query
    select
      'already_terminal'::text,
      r.id, r.organization_id, r.store_id, r.connection_id,
      r.actor_membership_id, r.kind, r.idempotency_key, r.status,
      r.started_at, r.completed_at, r.last_checkpoint_at,
      r.discovered_count, r.requested_count, r.fetched_count,
      r.persisted_count, r.failed_count, r.pages_count, r.batches_count,
      r.error_code, r.error_summary, r.updated_at
    from public.listing_sync_runs as r
    where r.id = recovery_run.id;
    return;
  end if;

  if recovery_run.last_checkpoint_at > p_stale_before then
    return query
    select
      'not_stale'::text,
      r.id, r.organization_id, r.store_id, r.connection_id,
      r.actor_membership_id, r.kind, r.idempotency_key, r.status,
      r.started_at, r.completed_at, r.last_checkpoint_at,
      r.discovered_count, r.requested_count, r.fetched_count,
      r.persisted_count, r.failed_count, r.pages_count, r.batches_count,
      r.error_code, r.error_summary, r.updated_at
    from public.listing_sync_runs as r
    where r.id = recovery_run.id;
    return;
  end if;

  if exists (
    select 1
    from public.audit_events as a
    where a.organization_id = recovery_run.organization_id
      and a.resource_type = 'listing_sync_run'
      and a.resource_id = recovery_run.id::text
      and a.action in (
        'listing.sync.succeeded',
        'listing.sync.partial',
        'listing.sync.failed'
      )
  ) then
    return query
    select
      'not_recoverable'::text,
      r.id, r.organization_id, r.store_id, r.connection_id,
      r.actor_membership_id, r.kind, r.idempotency_key, r.status,
      r.started_at, r.completed_at, r.last_checkpoint_at,
      r.discovered_count, r.requested_count, r.fetched_count,
      r.persisted_count, r.failed_count, r.pages_count, r.batches_count,
      r.error_code, r.error_summary, r.updated_at
    from public.listing_sync_runs as r
    where r.id = recovery_run.id;
    return;
  end if;

  if p_terminal_status = 'succeeded' and not (
    recovery_run.last_checkpoint_at > recovery_run.started_at
    and recovery_run.failed_count = 0
    and recovery_run.discovered_count = recovery_run.requested_count
    and recovery_run.requested_count = recovery_run.fetched_count
    and recovery_run.fetched_count = recovery_run.persisted_count
    and recovery_run.pages_count > 0
    and (
      (recovery_run.requested_count = 0 and recovery_run.batches_count = 0)
      or (recovery_run.requested_count > 0 and recovery_run.batches_count > 0)
    )
  ) then
    return query
    select
      'not_recoverable'::text,
      r.id, r.organization_id, r.store_id, r.connection_id,
      r.actor_membership_id, r.kind, r.idempotency_key, r.status,
      r.started_at, r.completed_at, r.last_checkpoint_at,
      r.discovered_count, r.requested_count, r.fetched_count,
      r.persisted_count, r.failed_count, r.pages_count, r.batches_count,
      r.error_code, r.error_summary, r.updated_at
    from public.listing_sync_runs as r
    where r.id = recovery_run.id;
    return;
  end if;

  update public.listing_sync_runs as r
  set
    status = p_terminal_status,
    completed_at = now(),
    error_code = case
      when p_terminal_status = 'failed' then 'administrative_recovery'
      else null
    end,
    error_summary = null,
    updated_at = now()
  where r.id = recovery_run.id
    and r.status = 'running'
  returning r.* into recovery_run;

  if recovery_run.id is null then
    raise exception 'listing_sync_recovery_rejected';
  end if;

  insert into public.audit_events (
    organization_id, store_id, actor_membership_id,
    action, resource_type, resource_id, metadata
  ) values (
    recovery_run.organization_id,
    recovery_run.store_id,
    p_recovery_actor_membership_id,
    'listing.sync.' || recovery_run.status,
    'listing_sync_run',
    recovery_run.id::text,
    jsonb_build_object(
      'kind', recovery_run.kind,
      'provider', connection_provider,
      'status', recovery_run.status
    )
  );

  insert into public.audit_events (
    organization_id, store_id, actor_membership_id,
    action, resource_type, resource_id, metadata
  ) values (
    recovery_run.organization_id,
    recovery_run.store_id,
    p_recovery_actor_membership_id,
    'listing.sync.recovered',
    'listing_sync_run',
    recovery_run.id::text,
    jsonb_build_object(
      'previous_status', 'running',
      'terminal_status', recovery_run.status,
      'recovery_reason', p_recovery_reason
    )
  );

  return query
  select
    'recovered'::text,
    r.id, r.organization_id, r.store_id, r.connection_id,
    r.actor_membership_id, r.kind, r.idempotency_key, r.status,
    r.started_at, r.completed_at, r.last_checkpoint_at,
    r.discovered_count, r.requested_count, r.fetched_count,
    r.persisted_count, r.failed_count, r.pages_count, r.batches_count,
    r.error_code, r.error_summary, r.updated_at
  from public.listing_sync_runs as r
  where r.id = recovery_run.id;
end;
$$;

revoke all on function public.recover_stale_listing_sync_run(text, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.recover_stale_listing_sync_run(text, uuid, uuid, text, text, timestamptz)
  to service_role;

comment on function public.recover_stale_listing_sync_run(text, uuid, uuid, text, text, timestamptz) is
  'Explicit Owner/Manager recovery for stale listing backfills; never invokes provider work.';
