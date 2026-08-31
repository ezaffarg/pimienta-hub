-- Controlled event processing with atomic claim and provider timestamp freshness CAS.

alter table public.integration_events
  drop constraint integration_events_status_check,
  drop constraint integration_events_safe_error_code_check,
  drop constraint integration_events_lifecycle_check,
  add column processing_attempts integer not null default 0
    check (processing_attempts >= 0),
  add column processing_lease_id uuid,
  add column processing_lease_expires_at timestamptz,
  add column retryable boolean not null default false,
  add column safe_error_summary text,
  add constraint integration_events_status_check
    check (status in ('received', 'processing', 'processed', 'failed')),
  add constraint integration_events_safe_error_code_check check (
    safe_error_code is null
    or safe_error_code in (
      'provider_rate_limited',
      'provider_timeout',
      'provider_unavailable',
      'invalid_provider_response',
      'persistence_failure',
      'resource_not_found',
      'ambiguous_provider_timestamp',
      'connection_binding_invalid'
    )
  ),
  add constraint integration_events_safe_error_summary_check check (
    safe_error_summary is null
    or (btrim(safe_error_summary) <> '' and char_length(safe_error_summary) <= 255)
  ),
  add constraint integration_events_lifecycle_check check (
    (status = 'received'
      and processed_at is null
      and processing_lease_id is null
      and processing_lease_expires_at is null
      and retryable is false
      and safe_error_code is null
      and safe_error_summary is null)
    or
    (status = 'processing'
      and processed_at is null
      and processing_lease_id is not null
      and processing_lease_expires_at is not null
      and retryable is false
      and safe_error_code is null
      and safe_error_summary is null)
    or
    (status = 'processed'
      and processed_at is not null
      and processing_lease_id is null
      and processing_lease_expires_at is null
      and retryable is false
      and safe_error_code is null
      and safe_error_summary is null)
    or
    (status = 'failed'
      and processed_at is null
      and processing_lease_id is null
      and processing_lease_expires_at is null
      and safe_error_code is not null
      and safe_error_summary is not null)
  );

create function public.claim_integration_event_processing(
  p_event_id uuid,
  p_lease_id uuid
)
returns table (
  outcome text,
  event_id uuid,
  organization_id text,
  store_id uuid,
  connection_id uuid,
  provider text,
  topic text,
  resource text,
  external_resource_id text,
  provider_user_id text,
  processing_attempts integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_event public.integration_events%rowtype;
  claimed_event public.integration_events%rowtype;
begin
  if p_event_id is null or p_lease_id is null then
    raise exception 'integration_event_claim_invalid';
  end if;

  select e.* into current_event
  from public.integration_events as e
  where e.id = p_event_id
  for update;

  if current_event.id is null then
    return query select 'not_found'::text, null::uuid, null::text, null::uuid,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      null::integer, null::timestamptz;
    return;
  end if;

  if current_event.status = 'processed' then
    return query select 'already_processed'::text, current_event.id,
      current_event.organization_id, current_event.store_id, current_event.connection_id,
      current_event.provider, current_event.topic, current_event.resource,
      current_event.external_resource_id, current_event.provider_user_id,
      current_event.processing_attempts, null::timestamptz;
    return;
  end if;

  if current_event.status = 'processing'
    and current_event.processing_lease_expires_at > now() then
    return query select 'already_processing'::text, current_event.id,
      current_event.organization_id, current_event.store_id, current_event.connection_id,
      current_event.provider, current_event.topic, current_event.resource,
      current_event.external_resource_id, current_event.provider_user_id,
      current_event.processing_attempts, current_event.processing_lease_expires_at;
    return;
  end if;

  if current_event.status = 'failed' and current_event.retryable is false then
    return query select 'not_retryable'::text, current_event.id,
      current_event.organization_id, current_event.store_id, current_event.connection_id,
      current_event.provider, current_event.topic, current_event.resource,
      current_event.external_resource_id, current_event.provider_user_id,
      current_event.processing_attempts, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1 from public.connections as c
    where c.id = current_event.connection_id
      and c.organization_id = current_event.organization_id
      and c.store_id = current_event.store_id
      and c.provider = current_event.provider
      and c.external_account_id = current_event.provider_user_id
      and c.status = 'active'
  ) then
    update public.integration_events as e
    set status = 'failed',
        processing_attempts = e.processing_attempts + 1,
        processing_lease_id = null,
        processing_lease_expires_at = null,
        retryable = false,
        safe_error_code = 'connection_binding_invalid',
        safe_error_summary = 'Connection binding is not processable',
        updated_at = now()
    where e.id = current_event.id;

    return query select 'binding_invalid'::text, current_event.id,
      current_event.organization_id, current_event.store_id, current_event.connection_id,
      current_event.provider, current_event.topic, current_event.resource,
      current_event.external_resource_id, current_event.provider_user_id,
      current_event.processing_attempts + 1, null::timestamptz;
    return;
  end if;

  update public.integration_events as e
  set status = 'processing',
      processing_attempts = e.processing_attempts + 1,
      processing_lease_id = p_lease_id,
      processing_lease_expires_at = now() + interval '5 minutes',
      retryable = false,
      processed_at = null,
      safe_error_code = null,
      safe_error_summary = null,
      updated_at = now()
  where e.id = current_event.id
  returning e.* into claimed_event;

  return query select 'claimed'::text, claimed_event.id,
    claimed_event.organization_id, claimed_event.store_id, claimed_event.connection_id,
    claimed_event.provider, claimed_event.topic, claimed_event.resource,
    claimed_event.external_resource_id, claimed_event.provider_user_id,
    claimed_event.processing_attempts, claimed_event.processing_lease_expires_at;
end;
$$;

create function public.complete_integration_event_listing(
  p_event_id uuid,
  p_lease_id uuid,
  p_synced_at timestamptz,
  p_listing jsonb
)
returns table(outcome text, listing_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_event public.integration_events%rowtype;
  current_listing public.listings%rowtype;
  completed_listing public.listings%rowtype;
  input record;
  result text;
begin
  if p_event_id is null or p_lease_id is null or p_synced_at is null
    or p_listing is null or jsonb_typeof(p_listing) <> 'object' then
    raise exception 'integration_event_listing_input_invalid';
  end if;

  select e.* into current_event
  from public.integration_events as e
  where e.id = p_event_id
  for update;

  if current_event.id is null
    or current_event.status <> 'processing'
    or current_event.processing_lease_id <> p_lease_id
    or current_event.processing_lease_expires_at <= now()
    or current_event.provider <> 'mercado-libre'
    or current_event.topic <> 'items' then
    raise exception 'integration_event_processing_lease_rejected';
  end if;

  if not exists (
    select 1 from public.connections as c
    where c.id = current_event.connection_id
      and c.organization_id = current_event.organization_id
      and c.store_id = current_event.store_id
      and c.provider = current_event.provider
      and c.external_account_id = current_event.provider_user_id
      and c.status = 'active'
  ) then
    raise exception 'integration_event_connection_binding_rejected';
  end if;

  select * into input
  from jsonb_to_record(p_listing) as value(
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
  );

  if input.external_listing_id is distinct from current_event.external_resource_id
    or input.provider_updated_at is null
    or input.title is null or btrim(input.title) = ''
    or input.status is null or btrim(input.status) = '' then
    raise exception 'integration_event_listing_input_invalid';
  end if;

  select l.* into current_listing
  from public.listings as l
  where l.connection_id = current_event.connection_id
    and l.external_listing_id = input.external_listing_id
  for update;

  if current_listing.id is null then
    insert into public.listings (
      organization_id, store_id, connection_id, external_listing_id, title, status,
      price, currency_id, available_quantity, sold_quantity, seller_sku,
      listing_type_id, condition, permalink, thumbnail_url, catalog_product_id,
      provider_created_at, provider_updated_at, last_synced_at,
      reconciliation_state, not_seen_since, consecutive_not_seen_count, updated_at
    ) values (
      current_event.organization_id, current_event.store_id, current_event.connection_id,
      input.external_listing_id, input.title, input.status, input.price,
      input.currency_id, input.available_quantity, input.sold_quantity,
      input.seller_sku, input.listing_type_id, input.condition, input.permalink,
      input.thumbnail_url, input.catalog_product_id, input.provider_created_at,
      input.provider_updated_at, p_synced_at, 'seen', null, 0, p_synced_at
    ) returning * into completed_listing;
    result := 'applied';
  elsif current_listing.provider_updated_at is null
    or input.provider_updated_at > current_listing.provider_updated_at then
    update public.listings as l
    set title = input.title,
        status = input.status,
        price = input.price,
        currency_id = input.currency_id,
        available_quantity = input.available_quantity,
        sold_quantity = input.sold_quantity,
        seller_sku = input.seller_sku,
        listing_type_id = input.listing_type_id,
        condition = input.condition,
        permalink = input.permalink,
        thumbnail_url = input.thumbnail_url,
        catalog_product_id = input.catalog_product_id,
        provider_created_at = input.provider_created_at,
        provider_updated_at = input.provider_updated_at,
        last_synced_at = p_synced_at,
        reconciliation_state = 'seen',
        not_seen_since = null,
        consecutive_not_seen_count = 0,
        updated_at = p_synced_at
    where l.id = current_listing.id
    returning l.* into completed_listing;
    result := 'applied';
  elsif input.provider_updated_at < current_listing.provider_updated_at then
    update public.listings as l
    set reconciliation_state = 'seen',
        not_seen_since = null,
        consecutive_not_seen_count = 0,
        updated_at = case
          when l.reconciliation_state = 'missing_candidate' then p_synced_at
          else l.updated_at
        end
    where l.id = current_listing.id
    returning l.* into completed_listing;
    result := 'stale_noop';
  elsif current_listing.title is not distinct from input.title
    and current_listing.status is not distinct from input.status
    and current_listing.price is not distinct from input.price
    and current_listing.currency_id is not distinct from input.currency_id
    and current_listing.available_quantity is not distinct from input.available_quantity
    and current_listing.sold_quantity is not distinct from input.sold_quantity
    and current_listing.seller_sku is not distinct from input.seller_sku
    and current_listing.listing_type_id is not distinct from input.listing_type_id
    and current_listing.condition is not distinct from input.condition
    and current_listing.permalink is not distinct from input.permalink
    and current_listing.thumbnail_url is not distinct from input.thumbnail_url
    and current_listing.catalog_product_id is not distinct from input.catalog_product_id
    and current_listing.provider_created_at is not distinct from input.provider_created_at then
    update public.listings as l
    set reconciliation_state = 'seen',
        not_seen_since = null,
        consecutive_not_seen_count = 0,
        updated_at = case
          when l.reconciliation_state = 'missing_candidate' then p_synced_at
          else l.updated_at
        end
    where l.id = current_listing.id
    returning l.* into completed_listing;
    result := 'equivalent_noop';
  else
    return query select 'freshness_conflict'::text, current_listing.id;
    return;
  end if;

  update public.integration_events as e
  set status = 'processed',
      processed_at = now(),
      processing_lease_id = null,
      processing_lease_expires_at = null,
      retryable = false,
      safe_error_code = null,
      safe_error_summary = null,
      updated_at = now()
  where e.id = current_event.id;

  return query select result, completed_listing.id;
end;
$$;

create function public.fail_integration_event_processing(
  p_event_id uuid,
  p_lease_id uuid,
  p_error_code text,
  p_error_summary text,
  p_retryable boolean
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_event public.integration_events%rowtype;
begin
  if p_event_id is null or p_lease_id is null or p_error_code is null
    or p_error_summary is null or p_retryable is null then
    raise exception 'integration_event_failure_invalid';
  end if;

  select e.* into current_event
  from public.integration_events as e
  where e.id = p_event_id
  for update;

  if current_event.id is null then return 'not_found'; end if;
  if current_event.status = 'processed' then return 'already_processed'; end if;
  if current_event.status <> 'processing'
    or current_event.processing_lease_id <> p_lease_id
    or current_event.processing_lease_expires_at <= now() then
    return 'lease_lost';
  end if;

  update public.integration_events as e
  set status = 'failed',
      processed_at = null,
      processing_lease_id = null,
      processing_lease_expires_at = null,
      retryable = p_retryable,
      safe_error_code = p_error_code,
      safe_error_summary = p_error_summary,
      updated_at = now()
  where e.id = current_event.id;

  return 'failed';
end;
$$;

revoke all on function public.claim_integration_event_processing(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_integration_event_listing(uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_integration_event_processing(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;

grant execute on function public.claim_integration_event_processing(uuid, uuid)
  to service_role;
grant execute on function public.complete_integration_event_listing(uuid, uuid, timestamptz, jsonb)
  to service_role;
grant execute on function public.fail_integration_event_processing(uuid, uuid, text, text, boolean)
  to service_role;

comment on column public.integration_events.processing_attempts is
  'Counts controlled processor claims, not provider delivery attempts.';
comment on column public.integration_events.retryable is
  'Classification only; X-D does not schedule or execute automatic retries.';
