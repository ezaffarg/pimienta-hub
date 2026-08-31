-- Durable retry scheduling for integration events. Missed feeds reuse intake and need no schema.

alter table public.integration_events
  drop constraint integration_events_safe_error_code_check,
  drop constraint integration_events_lifecycle_check,
  add column next_retry_at timestamptz,
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
      'connection_binding_invalid',
      'retry_exhausted'
    )
  ),
  add constraint integration_events_lifecycle_check check (
    (status = 'received'
      and processed_at is null
      and processing_lease_id is null
      and processing_lease_expires_at is null
      and retryable is false
      and next_retry_at is null
      and safe_error_code is null
      and safe_error_summary is null)
    or
    (status = 'processing'
      and processed_at is null
      and processing_lease_id is not null
      and processing_lease_expires_at is not null
      and retryable is false
      and next_retry_at is null
      and safe_error_code is null
      and safe_error_summary is null)
    or
    (status = 'processed'
      and processed_at is not null
      and processing_lease_id is null
      and processing_lease_expires_at is null
      and retryable is false
      and next_retry_at is null
      and safe_error_code is null
      and safe_error_summary is null)
    or
    (status = 'failed'
      and processed_at is null
      and processing_lease_id is null
      and processing_lease_expires_at is null
      and safe_error_code is not null
      and safe_error_summary is not null
      and ((retryable is true and next_retry_at is not null)
        or (retryable is false and next_retry_at is null)))
  );

create index integration_events_due_retry_idx
  on public.integration_events (next_retry_at, id)
  where status = 'failed' and retryable is true;

create or replace function public.claim_integration_event_processing(
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

  if current_event.status = 'failed'
    and current_event.retryable is true
    and current_event.next_retry_at > now() then
    return query select 'not_yet_due'::text, current_event.id,
      current_event.organization_id, current_event.store_id, current_event.connection_id,
      current_event.provider, current_event.topic, current_event.resource,
      current_event.external_resource_id, current_event.provider_user_id,
      current_event.processing_attempts, null::timestamptz;
    return;
  end if;

  if current_event.processing_attempts >= 5 then
    update public.integration_events as e
    set status = 'failed', retryable = false, next_retry_at = null,
        safe_error_code = 'retry_exhausted',
        safe_error_summary = 'Retry attempts exhausted', updated_at = now()
    where e.id = current_event.id;
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
    set status = 'failed', processing_attempts = e.processing_attempts + 1,
        processing_lease_id = null, processing_lease_expires_at = null,
        retryable = false, next_retry_at = null,
        safe_error_code = 'connection_binding_invalid',
        safe_error_summary = 'Connection binding is not processable', updated_at = now()
    where e.id = current_event.id;

    return query select 'binding_invalid'::text, current_event.id,
      current_event.organization_id, current_event.store_id, current_event.connection_id,
      current_event.provider, current_event.topic, current_event.resource,
      current_event.external_resource_id, current_event.provider_user_id,
      current_event.processing_attempts + 1, null::timestamptz;
    return;
  end if;

  update public.integration_events as e
  set status = 'processing', processing_attempts = e.processing_attempts + 1,
      processing_lease_id = p_lease_id,
      processing_lease_expires_at = now() + interval '5 minutes',
      retryable = false, next_retry_at = null, processed_at = null,
      safe_error_code = null, safe_error_summary = null, updated_at = now()
  where e.id = current_event.id
  returning e.* into claimed_event;

  return query select 'claimed'::text, claimed_event.id,
    claimed_event.organization_id, claimed_event.store_id, claimed_event.connection_id,
    claimed_event.provider, claimed_event.topic, claimed_event.resource,
    claimed_event.external_resource_id, claimed_event.provider_user_id,
    claimed_event.processing_attempts, claimed_event.processing_lease_expires_at;
end;
$$;

drop function public.fail_integration_event_processing(uuid, uuid, text, text, boolean);

create function public.fail_integration_event_processing(
  p_event_id uuid,
  p_lease_id uuid,
  p_error_code text,
  p_error_summary text,
  p_retryable boolean,
  p_retry_after_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_event public.integration_events%rowtype;
  base_delay_seconds integer;
  jitter_seconds integer;
  local_retry_at timestamptz;
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

  if p_retryable and current_event.processing_attempts >= 5 then
    update public.integration_events as e
    set status = 'failed', processed_at = null,
        processing_lease_id = null, processing_lease_expires_at = null,
        retryable = false, next_retry_at = null,
        safe_error_code = 'retry_exhausted',
        safe_error_summary = 'Retry attempts exhausted', updated_at = now()
    where e.id = current_event.id;
    return 'retry_exhausted';
  end if;

  if p_retryable then
    base_delay_seconds := least(
      3600,
      (30 * power(2, greatest(current_event.processing_attempts - 1, 0)))::integer
    );
    jitter_seconds := mod(
      abs(hashtextextended(
        current_event.id::text || ':' || current_event.processing_attempts::text,
        0
      )::numeric),
      greatest(1, floor(base_delay_seconds * 0.25)::integer + 1)
    )::integer;
    local_retry_at := now() + make_interval(
      secs => least(3600, base_delay_seconds + jitter_seconds)
    );

    update public.integration_events as e
    set status = 'failed', processed_at = null,
        processing_lease_id = null, processing_lease_expires_at = null,
        retryable = true,
        next_retry_at = greatest(local_retry_at, p_retry_after_at),
        safe_error_code = p_error_code, safe_error_summary = p_error_summary,
        updated_at = now()
    where e.id = current_event.id;
    return 'retry_scheduled';
  end if;

  update public.integration_events as e
  set status = 'failed', processed_at = null,
      processing_lease_id = null, processing_lease_expires_at = null,
      retryable = false, next_retry_at = null,
      safe_error_code = p_error_code, safe_error_summary = p_error_summary,
      updated_at = now()
  where e.id = current_event.id;
  return 'failed';
end;
$$;

create function public.list_due_integration_event_retries(p_limit integer)
returns table(event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
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
  where e.status = 'failed'
    and e.retryable is true
    and e.processing_attempts < 5
    and e.next_retry_at <= now()
    and e.processing_lease_id is null
    and e.processing_lease_expires_at is null
  order by e.next_retry_at asc, e.id asc
  limit p_limit;
end;
$$;

revoke all on function public.fail_integration_event_processing(
  uuid, uuid, text, text, boolean, timestamptz
) from public, anon, authenticated;
revoke all on function public.list_due_integration_event_retries(integer)
  from public, anon, authenticated;

grant execute on function public.fail_integration_event_processing(
  uuid, uuid, text, text, boolean, timestamptz
) to service_role;
grant execute on function public.list_due_integration_event_retries(integer)
  to service_role;

comment on column public.integration_events.next_retry_at is
  'Earliest retry claim time. Selection does not claim or increment attempts.';
