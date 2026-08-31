-- Durable, provider-agnostic integration event intake. No callback or worker.

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  store_id uuid not null,
  connection_id uuid not null,
  provider text not null
    check (provider in ('mercado-libre', 'shopify', 'tiendanube', 'woocommerce')),
  topic text not null check (topic ~ '^[a-z][a-z0-9_-]{0,99}$'),
  resource text not null
    check (resource ~ '^/[^[:space:]]+$' and char_length(resource) <= 512),
  external_resource_id text not null
    check (btrim(external_resource_id) <> '' and char_length(external_resource_id) <= 255),
  external_event_id text
    check (external_event_id is null or (
      btrim(external_event_id) <> '' and char_length(external_event_id) <= 255
    )),
  dedupe_key text not null check (dedupe_key ~ '^[0-9a-f]{64}$'),
  provider_user_id text not null
    check (btrim(provider_user_id) <> '' and char_length(provider_user_id) <= 255),
  application_id text not null
    check (btrim(application_id) <> '' and char_length(application_id) <= 255),
  provider_sent_at timestamptz not null,
  provider_received_at timestamptz,
  received_at timestamptz not null default now(),
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed')),
  delivery_attempts integer not null check (delivery_attempts > 0),
  processed_at timestamptz,
  safe_error_code text check (
    safe_error_code is null
    or safe_error_code in (
      'provider_rate_limited',
      'provider_timeout',
      'provider_unavailable',
      'invalid_provider_response',
      'persistence_failure',
      'resource_not_found',
      'ambiguous_provider_timestamp'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_events_connection_scope_fkey
    foreign key (connection_id, store_id, organization_id)
    references public.connections (id, store_id, organization_id)
    on delete restrict,
  constraint integration_events_provider_application_dedupe_key
    unique (provider, application_id, dedupe_key),
  constraint integration_events_lifecycle_check check (
    (status = 'received' and processed_at is null and safe_error_code is null)
    or
    (status = 'processed' and processed_at is not null and safe_error_code is null)
    or
    (status = 'failed' and processed_at is not null and safe_error_code is not null)
  )
);

alter table public.integration_events enable row level security;

revoke all on table public.integration_events from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_events to service_role;

create function public.intake_integration_event(
  p_organization_id text,
  p_store_id uuid,
  p_connection_id uuid,
  p_provider text,
  p_topic text,
  p_resource text,
  p_external_resource_id text,
  p_external_event_id text,
  p_dedupe_key text,
  p_provider_user_id text,
  p_application_id text,
  p_provider_sent_at timestamptz,
  p_provider_received_at timestamptz,
  p_delivery_attempts integer
)
returns table (
  outcome text,
  id uuid,
  organization_id text,
  store_id uuid,
  connection_id uuid,
  provider text,
  topic text,
  resource text,
  external_resource_id text,
  external_event_id text,
  dedupe_key text,
  provider_user_id text,
  application_id text,
  provider_sent_at timestamptz,
  provider_received_at timestamptz,
  received_at timestamptz,
  status text,
  delivery_attempts integer,
  processed_at timestamptz,
  safe_error_code text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  event_row public.integration_events%rowtype;
begin
  if not exists (
    select 1
    from public.connections c
    where c.id = p_connection_id
      and c.organization_id = p_organization_id
      and c.store_id = p_store_id
      and c.provider = p_provider
      and c.external_account_id = p_provider_user_id
      and c.status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'integration event scope rejected';
  end if;

  insert into public.integration_events (
    organization_id, store_id, connection_id, provider, topic, resource,
    external_resource_id, external_event_id, dedupe_key, provider_user_id,
    application_id, provider_sent_at, provider_received_at, delivery_attempts
  ) values (
    p_organization_id, p_store_id, p_connection_id, p_provider, p_topic, p_resource,
    p_external_resource_id, p_external_event_id, p_dedupe_key, p_provider_user_id,
    p_application_id, p_provider_sent_at, p_provider_received_at, p_delivery_attempts
  )
  on conflict on constraint integration_events_provider_application_dedupe_key do nothing
  returning * into event_row;

  if event_row.id is not null then
    return query select
      'accepted', event_row.id, event_row.organization_id, event_row.store_id,
      event_row.connection_id, event_row.provider, event_row.topic, event_row.resource,
      event_row.external_resource_id, event_row.external_event_id, event_row.dedupe_key,
      event_row.provider_user_id, event_row.application_id, event_row.provider_sent_at,
      event_row.provider_received_at, event_row.received_at, event_row.status,
      event_row.delivery_attempts, event_row.processed_at, event_row.safe_error_code,
      event_row.created_at, event_row.updated_at;
    return;
  end if;

  select e.* into strict event_row
  from public.integration_events e
  where e.provider = p_provider
    and e.application_id = p_application_id
    and e.dedupe_key = p_dedupe_key;

  if event_row.organization_id is distinct from p_organization_id
    or event_row.store_id is distinct from p_store_id
    or event_row.connection_id is distinct from p_connection_id
    or event_row.topic is distinct from p_topic
    or event_row.resource is distinct from p_resource
    or event_row.external_resource_id is distinct from p_external_resource_id
    or event_row.external_event_id is distinct from p_external_event_id
    or event_row.provider_user_id is distinct from p_provider_user_id
    or event_row.provider_sent_at is distinct from p_provider_sent_at
  then
    raise exception using errcode = 'P0001', message = 'integration event dedupe conflict';
  end if;

  return query select
    'duplicate', event_row.id, event_row.organization_id, event_row.store_id,
    event_row.connection_id, event_row.provider, event_row.topic, event_row.resource,
    event_row.external_resource_id, event_row.external_event_id, event_row.dedupe_key,
    event_row.provider_user_id, event_row.application_id, event_row.provider_sent_at,
    event_row.provider_received_at, event_row.received_at, event_row.status,
    event_row.delivery_attempts, event_row.processed_at, event_row.safe_error_code,
    event_row.created_at, event_row.updated_at;
end;
$$;

revoke all on function public.intake_integration_event(text, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.intake_integration_event(text, uuid, uuid, text, text, text, text, text, text, text, text, timestamptz, timestamptz, integer)
  to service_role;

comment on table public.integration_events is
  'Normalized durable integration event intake. Raw provider payloads and secrets are prohibited.';
