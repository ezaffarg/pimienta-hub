-- Provider listing backfill runs. Checkpoints are observability only, never resumability.

create table public.listing_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  store_id uuid not null,
  connection_id uuid not null,
  actor_membership_id uuid not null,
  kind text not null check (kind = 'listing_backfill'),
  idempotency_key uuid not null,
  status text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_checkpoint_at timestamptz not null default now(),
  discovered_count bigint not null default 0 check (discovered_count >= 0),
  requested_count bigint not null default 0 check (requested_count >= 0),
  fetched_count bigint not null default 0 check (fetched_count >= 0),
  persisted_count bigint not null default 0 check (persisted_count >= 0),
  failed_count bigint not null default 0 check (failed_count >= 0),
  pages_count bigint not null default 0 check (pages_count >= 0),
  batches_count bigint not null default 0 check (batches_count >= 0),
  error_code text check (
    error_code is null
    or error_code in (
      'provider_rate_limited',
      'provider_timeout',
      'provider_unavailable',
      'invalid_provider_response',
      'credential_failure',
      'persistence_failure',
      'partial_item_failure'
    )
  ),
  error_summary text check (
    error_summary is null
    or (
      btrim(error_summary) <> ''
      and char_length(error_summary) <= 512
      and lower(error_summary) !~ '(access[_ -]?token|refresh[_ -]?token|authorization|cookie|password|secret)'
    )
  ),
  updated_at timestamptz not null default now(),
  constraint listing_sync_runs_connection_scope_fkey
    foreign key (connection_id, store_id, organization_id)
    references public.connections (id, store_id, organization_id)
    on delete restrict,
  constraint listing_sync_runs_actor_scope_fkey
    foreign key (actor_membership_id, organization_id)
    references public.hub_memberships (id, organization_id)
    on delete restrict,
  constraint listing_sync_runs_idempotency_key
    unique (organization_id, connection_id, kind, idempotency_key),
  constraint listing_sync_runs_terminal_state_check check (
    (status = 'running' and completed_at is null and error_code is null and error_summary is null)
    or
    (status = 'succeeded' and completed_at is not null and error_code is null and error_summary is null)
    or
    (status in ('partial', 'failed') and completed_at is not null and error_code is not null)
  )
);

create unique index listing_sync_runs_one_running_per_connection_kind
  on public.listing_sync_runs (connection_id, kind)
  where status = 'running';

create index listing_sync_runs_organization_store_started_idx
  on public.listing_sync_runs (organization_id, store_id, started_at desc);

alter table public.listing_sync_runs enable row level security;

revoke all on table public.listing_sync_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.listing_sync_runs to service_role;

create function public.start_listing_sync_run(
  p_organization_id text,
  p_store_id uuid,
  p_connection_id uuid,
  p_actor_membership_id uuid,
  p_idempotency_key uuid
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
  connection_provider text;
  connection_status text;
  existing_run_id uuid;
  running_run_id uuid;
  created_run_id uuid;
begin
  select c.provider, c.status
    into connection_provider, connection_status
  from public.connections as c
  where c.id = p_connection_id
    and c.organization_id = p_organization_id
    and c.store_id = p_store_id
  for update;

  if connection_provider is null then
    raise exception 'listing_sync_scope_invalid';
  end if;

  if not exists (
    select 1
    from public.hub_memberships as hm
    where hm.id = p_actor_membership_id
      and hm.organization_id = p_organization_id
  ) then
    raise exception 'listing_sync_actor_invalid';
  end if;

  select r.id
    into existing_run_id
  from public.listing_sync_runs as r
  where r.organization_id = p_organization_id
    and r.connection_id = p_connection_id
    and r.kind = 'listing_backfill'
    and r.idempotency_key = p_idempotency_key;

  if existing_run_id is not null then
    return query
    select
      'reused'::text,
      r.id, r.organization_id, r.store_id, r.connection_id,
      r.actor_membership_id, r.kind, r.idempotency_key, r.status,
      r.started_at, r.completed_at, r.last_checkpoint_at,
      r.discovered_count, r.requested_count, r.fetched_count,
      r.persisted_count, r.failed_count, r.pages_count, r.batches_count,
      r.error_code, r.error_summary, r.updated_at
    from public.listing_sync_runs as r
    where r.id = existing_run_id;
    return;
  end if;

  if connection_status <> 'active' then
    raise exception 'listing_sync_connection_inactive';
  end if;

  select r.id
    into running_run_id
  from public.listing_sync_runs as r
  where r.connection_id = p_connection_id
    and r.kind = 'listing_backfill'
    and r.status = 'running';

  if running_run_id is not null then
    return query
    select
      'already_running'::text,
      r.id, r.organization_id, r.store_id, r.connection_id,
      r.actor_membership_id, r.kind, r.idempotency_key, r.status,
      r.started_at, r.completed_at, r.last_checkpoint_at,
      r.discovered_count, r.requested_count, r.fetched_count,
      r.persisted_count, r.failed_count, r.pages_count, r.batches_count,
      r.error_code, r.error_summary, r.updated_at
    from public.listing_sync_runs as r
    where r.id = running_run_id;
    return;
  end if;

  insert into public.listing_sync_runs (
    organization_id, store_id, connection_id, actor_membership_id,
    kind, idempotency_key, status
  ) values (
    p_organization_id, p_store_id, p_connection_id, p_actor_membership_id,
    'listing_backfill', p_idempotency_key, 'running'
  )
  returning listing_sync_runs.id into created_run_id;

  insert into public.audit_events (
    organization_id, store_id, actor_membership_id,
    action, resource_type, resource_id, metadata
  ) values (
    p_organization_id, p_store_id, p_actor_membership_id,
    'listing.sync.started', 'listing_sync_run', created_run_id::text,
    jsonb_build_object(
      'kind', 'listing_backfill',
      'provider', connection_provider,
      'status', 'running'
    )
  );

  return query
  select
    'started'::text,
    r.id, r.organization_id, r.store_id, r.connection_id,
    r.actor_membership_id, r.kind, r.idempotency_key, r.status,
    r.started_at, r.completed_at, r.last_checkpoint_at,
    r.discovered_count, r.requested_count, r.fetched_count,
    r.persisted_count, r.failed_count, r.pages_count, r.batches_count,
    r.error_code, r.error_summary, r.updated_at
  from public.listing_sync_runs as r
  where r.id = created_run_id;
end;
$$;

create function public.checkpoint_listing_sync_run(
  p_organization_id text,
  p_store_id uuid,
  p_connection_id uuid,
  p_run_id uuid,
  p_discovered_count bigint,
  p_requested_count bigint,
  p_fetched_count bigint,
  p_persisted_count bigint,
  p_failed_count bigint,
  p_pages_count bigint,
  p_batches_count bigint
)
returns setof public.listing_sync_runs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  updated_run public.listing_sync_runs%rowtype;
begin
  if p_discovered_count is null
    or p_requested_count is null
    or p_fetched_count is null
    or p_persisted_count is null
    or p_failed_count is null
    or p_pages_count is null
    or p_batches_count is null
    or least(
    p_discovered_count,
    p_requested_count,
    p_fetched_count,
    p_persisted_count,
    p_failed_count,
    p_pages_count,
    p_batches_count
  ) < 0 then
    raise exception 'listing_sync_counters_invalid';
  end if;

  update public.listing_sync_runs as r
  set
    discovered_count = p_discovered_count,
    requested_count = p_requested_count,
    fetched_count = p_fetched_count,
    persisted_count = p_persisted_count,
    failed_count = p_failed_count,
    pages_count = p_pages_count,
    batches_count = p_batches_count,
    last_checkpoint_at = now(),
    updated_at = now()
  where r.id = p_run_id
    and r.organization_id = p_organization_id
    and r.store_id = p_store_id
    and r.connection_id = p_connection_id
    and r.status = 'running'
    and p_discovered_count >= r.discovered_count
    and p_requested_count >= r.requested_count
    and p_fetched_count >= r.fetched_count
    and p_persisted_count >= r.persisted_count
    and p_failed_count >= r.failed_count
    and p_pages_count >= r.pages_count
    and p_batches_count >= r.batches_count
  returning r.* into updated_run;

  if updated_run.id is null then
    raise exception 'listing_sync_checkpoint_rejected';
  end if;

  return next updated_run;
end;
$$;

create function public.finalize_listing_sync_run(
  p_organization_id text,
  p_store_id uuid,
  p_connection_id uuid,
  p_run_id uuid,
  p_status text,
  p_discovered_count bigint,
  p_requested_count bigint,
  p_fetched_count bigint,
  p_persisted_count bigint,
  p_failed_count bigint,
  p_pages_count bigint,
  p_batches_count bigint,
  p_error_code text default null,
  p_error_summary text default null
)
returns setof public.listing_sync_runs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  completed_run public.listing_sync_runs%rowtype;
  connection_provider text;
begin
  if p_status not in ('succeeded', 'partial', 'failed') then
    raise exception 'listing_sync_terminal_status_invalid';
  end if;

  if p_discovered_count is null
    or p_requested_count is null
    or p_fetched_count is null
    or p_persisted_count is null
    or p_failed_count is null
    or p_pages_count is null
    or p_batches_count is null
    or least(
    p_discovered_count,
    p_requested_count,
    p_fetched_count,
    p_persisted_count,
    p_failed_count,
    p_pages_count,
    p_batches_count
  ) < 0 then
    raise exception 'listing_sync_counters_invalid';
  end if;

  if (p_status = 'succeeded' and (p_error_code is not null or p_error_summary is not null))
    or (p_status in ('partial', 'failed') and p_error_code is null) then
    raise exception 'listing_sync_error_contract_invalid';
  end if;

  select c.provider
    into connection_provider
  from public.connections as c
  where c.id = p_connection_id
    and c.organization_id = p_organization_id
    and c.store_id = p_store_id;

  if connection_provider is null then
    raise exception 'listing_sync_scope_invalid';
  end if;

  update public.listing_sync_runs as r
  set
    status = p_status,
    completed_at = now(),
    last_checkpoint_at = now(),
    discovered_count = p_discovered_count,
    requested_count = p_requested_count,
    fetched_count = p_fetched_count,
    persisted_count = p_persisted_count,
    failed_count = p_failed_count,
    pages_count = p_pages_count,
    batches_count = p_batches_count,
    error_code = p_error_code,
    error_summary = p_error_summary,
    updated_at = now()
  where r.id = p_run_id
    and r.organization_id = p_organization_id
    and r.store_id = p_store_id
    and r.connection_id = p_connection_id
    and r.status = 'running'
    and p_discovered_count >= r.discovered_count
    and p_requested_count >= r.requested_count
    and p_fetched_count >= r.fetched_count
    and p_persisted_count >= r.persisted_count
    and p_failed_count >= r.failed_count
    and p_pages_count >= r.pages_count
    and p_batches_count >= r.batches_count
  returning r.* into completed_run;

  if completed_run.id is null then
    raise exception 'listing_sync_finalize_rejected';
  end if;

  insert into public.audit_events (
    organization_id, store_id, actor_membership_id,
    action, resource_type, resource_id, metadata
  ) values (
    completed_run.organization_id,
    completed_run.store_id,
    completed_run.actor_membership_id,
    'listing.sync.' || completed_run.status,
    'listing_sync_run',
    completed_run.id::text,
    jsonb_build_object(
      'kind', completed_run.kind,
      'provider', connection_provider,
      'status', completed_run.status
    )
  );

  return next completed_run;
end;
$$;

revoke all on function public.start_listing_sync_run(text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.checkpoint_listing_sync_run(text, uuid, uuid, uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.finalize_listing_sync_run(text, uuid, uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, text)
  from public, anon, authenticated;

grant execute on function public.start_listing_sync_run(text, uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.checkpoint_listing_sync_run(text, uuid, uuid, uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint)
  to service_role;
grant execute on function public.finalize_listing_sync_run(text, uuid, uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, text)
  to service_role;

comment on table public.listing_sync_runs is
  'Server-only listing backfill observability. Checkpoints do not contain provider cursors and cannot resume a run.';
