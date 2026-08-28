-- Reversible, run-aware listing reconciliation. Absence never changes provider status.

alter table public.listing_sync_runs
  add column reconciliation_eligible boolean not null default false,
  add column missing_candidate_count bigint not null default 0
    check (missing_candidate_count >= 0),
  add column reappeared_count bigint not null default 0
    check (reappeared_count >= 0),
  add constraint listing_sync_runs_id_connection_store_organization_key
    unique (id, connection_id, store_id, organization_id);

alter table public.listings
  add column last_seen_sync_run_id uuid,
  add column reconciliation_state text not null default 'seen'
    check (reconciliation_state in ('seen', 'missing_candidate')),
  add column not_seen_since timestamptz,
  add column consecutive_not_seen_count bigint not null default 0
    check (consecutive_not_seen_count >= 0),
  add constraint listings_reconciliation_state_coherence_check check (
    (reconciliation_state = 'seen'
      and not_seen_since is null
      and consecutive_not_seen_count = 0)
    or
    (reconciliation_state = 'missing_candidate'
      and not_seen_since is not null
      and consecutive_not_seen_count > 0)
  ),
  add constraint listings_last_seen_sync_run_scope_fkey
    foreign key (last_seen_sync_run_id, connection_id, store_id, organization_id)
    references public.listing_sync_runs (id, connection_id, store_id, organization_id)
    on delete restrict;

create index listings_connection_reconciliation_run_idx
  on public.listings (connection_id, reconciliation_state, last_seen_sync_run_id);

create function public.persist_listing_sync_batch_for_run(
  p_organization_id text,
  p_store_id uuid,
  p_connection_id uuid,
  p_run_id uuid,
  p_synced_at timestamptz,
  p_listings jsonb
)
returns setof public.listings
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_run public.listing_sync_runs%rowtype;
  reappeared_delta bigint;
begin
  if p_synced_at is null
    or p_listings is null
    or jsonb_typeof(p_listings) <> 'array'
    or jsonb_array_length(p_listings) = 0 then
    raise exception 'listing_sync_batch_invalid';
  end if;

  select r.*
    into current_run
  from public.listing_sync_runs as r
  where r.id = p_run_id
    and r.organization_id = p_organization_id
    and r.store_id = p_store_id
    and r.connection_id = p_connection_id
  for update;

  if current_run.id is null or current_run.status <> 'running' then
    raise exception 'listing_sync_batch_run_rejected';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_listings) as input(external_listing_id text)
    group by input.external_listing_id
    having input.external_listing_id is null
      or btrim(input.external_listing_id) = ''
      or count(*) > 1
  ) then
    raise exception 'listing_sync_batch_items_invalid';
  end if;

  if exists (
    select 1
    from public.listings as l
    join public.listing_sync_runs as seen_run
      on seen_run.id = l.last_seen_sync_run_id
    join jsonb_to_recordset(p_listings) as input(external_listing_id text)
      on input.external_listing_id = l.external_listing_id
    where l.organization_id = p_organization_id
      and l.store_id = p_store_id
      and l.connection_id = p_connection_id
      and seen_run.id <> current_run.id
      and seen_run.started_at >= current_run.started_at
  ) then
    raise exception 'listing_sync_batch_superseded';
  end if;

  select count(*)
    into reappeared_delta
  from public.listings as l
  join jsonb_to_recordset(p_listings) as input(external_listing_id text)
    on input.external_listing_id = l.external_listing_id
  where l.organization_id = p_organization_id
    and l.store_id = p_store_id
    and l.connection_id = p_connection_id
    and l.reconciliation_state = 'missing_candidate';

  insert into public.listings (
    organization_id, store_id, connection_id, external_listing_id, title, status,
    price, currency_id, available_quantity, sold_quantity, seller_sku,
    listing_type_id, condition, permalink, thumbnail_url, catalog_product_id,
    provider_created_at, provider_updated_at, last_synced_at, updated_at,
    last_seen_sync_run_id, reconciliation_state, not_seen_since,
    consecutive_not_seen_count
  )
  select
    p_organization_id, p_store_id, p_connection_id,
    input.external_listing_id, input.title, input.status, input.price,
    input.currency_id, input.available_quantity, input.sold_quantity,
    input.seller_sku, input.listing_type_id, input.condition, input.permalink,
    input.thumbnail_url, input.catalog_product_id, input.provider_created_at,
    input.provider_updated_at, p_synced_at, p_synced_at, p_run_id, 'seen', null, 0
  from jsonb_to_recordset(p_listings) as input(
    external_listing_id text,
    title text,
    status text,
    price numeric,
    currency_id text,
    available_quantity integer,
    sold_quantity integer,
    seller_sku text,
    listing_type_id text,
    condition text,
    permalink text,
    thumbnail_url text,
    catalog_product_id text,
    provider_created_at timestamptz,
    provider_updated_at timestamptz
  )
  on conflict (connection_id, external_listing_id) do update set
    title = excluded.title,
    status = excluded.status,
    price = excluded.price,
    currency_id = excluded.currency_id,
    available_quantity = excluded.available_quantity,
    sold_quantity = excluded.sold_quantity,
    seller_sku = excluded.seller_sku,
    listing_type_id = excluded.listing_type_id,
    condition = excluded.condition,
    permalink = excluded.permalink,
    thumbnail_url = excluded.thumbnail_url,
    catalog_product_id = excluded.catalog_product_id,
    provider_created_at = excluded.provider_created_at,
    provider_updated_at = excluded.provider_updated_at,
    last_synced_at = excluded.last_synced_at,
    updated_at = excluded.updated_at,
    last_seen_sync_run_id = excluded.last_seen_sync_run_id,
    reconciliation_state = 'seen',
    not_seen_since = null,
    consecutive_not_seen_count = 0;

  update public.listing_sync_runs as r
  set reappeared_count = r.reappeared_count + reappeared_delta,
      updated_at = now()
  where r.id = current_run.id;

  return query
  select l.*
  from public.listings as l
  join jsonb_to_recordset(p_listings) as input(external_listing_id text)
    on input.external_listing_id = l.external_listing_id
  where l.organization_id = p_organization_id
    and l.store_id = p_store_id
    and l.connection_id = p_connection_id;
end;
$$;

create function public.finalize_listing_sync_run_with_reconciliation(
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
  p_reconciliation_eligible boolean,
  p_error_code text default null,
  p_error_summary text default null
)
returns setof public.listing_sync_runs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_run public.listing_sync_runs%rowtype;
  completed_run public.listing_sync_runs%rowtype;
  connection_provider text;
  reconciliation_time timestamptz := now();
  new_missing_count bigint := 0;
begin
  if p_status not in ('succeeded', 'partial', 'failed') then
    raise exception 'listing_sync_terminal_status_invalid';
  end if;

  if p_reconciliation_eligible is null
    or p_discovered_count is null
    or p_requested_count is null
    or p_fetched_count is null
    or p_persisted_count is null
    or p_failed_count is null
    or p_pages_count is null
    or p_batches_count is null
    or least(
      p_discovered_count, p_requested_count, p_fetched_count,
      p_persisted_count, p_failed_count, p_pages_count, p_batches_count
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
    and c.store_id = p_store_id
  for update;

  if connection_provider is null then
    raise exception 'listing_sync_scope_invalid';
  end if;

  select r.*
    into current_run
  from public.listing_sync_runs as r
  where r.id = p_run_id
    and r.organization_id = p_organization_id
    and r.store_id = p_store_id
    and r.connection_id = p_connection_id
  for update;

  if current_run.id is null then
    raise exception 'listing_sync_finalize_rejected';
  end if;

  if current_run.status <> 'running' then
    return next current_run;
    return;
  end if;

  if p_discovered_count < current_run.discovered_count
    or p_requested_count < current_run.requested_count
    or p_fetched_count < current_run.fetched_count
    or p_persisted_count < current_run.persisted_count
    or p_failed_count < current_run.failed_count
    or p_pages_count < current_run.pages_count
    or p_batches_count < current_run.batches_count then
    raise exception 'listing_sync_finalize_rejected';
  end if;

  if p_reconciliation_eligible and not (
    p_status = 'succeeded'
    and p_failed_count = 0
    and p_discovered_count = p_requested_count
    and p_requested_count = p_fetched_count
    and p_fetched_count = p_persisted_count
    and p_pages_count > 0
    and (
      (p_discovered_count = 0 and p_batches_count = 0)
      or (p_discovered_count > 0 and p_batches_count > 0)
    )
  ) then
    raise exception 'listing_sync_reconciliation_ineligible';
  end if;

  if p_reconciliation_eligible and exists (
    select 1
    from public.listings as l
    join public.listing_sync_runs as seen_run
      on seen_run.id = l.last_seen_sync_run_id
    where l.organization_id = p_organization_id
      and l.store_id = p_store_id
      and l.connection_id = p_connection_id
      and seen_run.id <> current_run.id
      and seen_run.started_at >= current_run.started_at
  ) then
    raise exception 'listing_sync_reconciliation_superseded';
  end if;

  if p_reconciliation_eligible then
    with candidates as (
      select l.id, l.reconciliation_state
      from public.listings as l
      where l.organization_id = p_organization_id
        and l.store_id = p_store_id
        and l.connection_id = p_connection_id
        and l.last_seen_sync_run_id is distinct from p_run_id
      for update
    ), reconciled as (
      update public.listings as l
      set reconciliation_state = 'missing_candidate',
          not_seen_since = case
            when candidates.reconciliation_state = 'seen' then reconciliation_time
            else l.not_seen_since
          end,
          consecutive_not_seen_count = case
            when candidates.reconciliation_state = 'seen' then 1
            else l.consecutive_not_seen_count + 1
          end,
          updated_at = reconciliation_time
      from candidates
      where l.id = candidates.id
      returning candidates.reconciliation_state
    )
    select count(*) filter (where reconciliation_state = 'seen')
      into new_missing_count
    from reconciled;
  end if;

  update public.listing_sync_runs as r
  set status = p_status,
      completed_at = reconciliation_time,
      last_checkpoint_at = reconciliation_time,
      discovered_count = p_discovered_count,
      requested_count = p_requested_count,
      fetched_count = p_fetched_count,
      persisted_count = p_persisted_count,
      failed_count = p_failed_count,
      pages_count = p_pages_count,
      batches_count = p_batches_count,
      reconciliation_eligible = p_reconciliation_eligible,
      missing_candidate_count = new_missing_count,
      error_code = p_error_code,
      error_summary = p_error_summary,
      updated_at = reconciliation_time
  where r.id = current_run.id
  returning r.* into completed_run;

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
      'status', completed_run.status,
      'reconciliation_eligible', completed_run.reconciliation_eligible,
      'missing_candidate_count', completed_run.missing_candidate_count,
      'reappeared_count', completed_run.reappeared_count
    )
  );

  return next completed_run;
end;
$$;

revoke all on function public.persist_listing_sync_batch_for_run(text, uuid, uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.finalize_listing_sync_run_with_reconciliation(text, uuid, uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, text, text)
  from public, anon, authenticated;

grant execute on function public.persist_listing_sync_batch_for_run(text, uuid, uuid, uuid, timestamptz, jsonb)
  to service_role;
grant execute on function public.finalize_listing_sync_run_with_reconciliation(text, uuid, uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, text, text)
  to service_role;

comment on column public.listings.reconciliation_state is
  'Internal reversible evidence only. missing_candidate never implies a provider status.';
comment on column public.listing_sync_runs.reconciliation_eligible is
  'True only when the fixed technical discovery profile completed without gaps; not a provider-authoritative snapshot.';
