-- Provider-agnostic external listing persistence. Browser access remains denied.

alter table public.connections
  add constraint connections_id_store_organization_key unique (id, store_id, organization_id);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  store_id uuid not null,
  connection_id uuid not null,
  external_listing_id text not null check (btrim(external_listing_id) <> ''),
  title text not null check (btrim(title) <> ''),
  status text not null check (btrim(status) <> ''),
  price numeric(20, 4) check (price is null or price >= 0),
  currency_id text,
  available_quantity integer check (available_quantity is null or available_quantity >= 0),
  sold_quantity integer check (sold_quantity is null or sold_quantity >= 0),
  seller_sku text,
  listing_type_id text,
  condition text,
  permalink text,
  thumbnail_url text,
  catalog_product_id text,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  last_synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listings_connection_store_organization_fkey
    foreign key (connection_id, store_id, organization_id)
    references public.connections (id, store_id, organization_id)
    on delete restrict,
  constraint listings_connection_external_listing_key
    unique (connection_id, external_listing_id)
);

create index listings_organization_store_idx
  on public.listings (organization_id, store_id);

create index listings_connection_last_synced_idx
  on public.listings (connection_id, last_synced_at);

alter table public.listings enable row level security;

revoke all on table public.listings from public, anon, authenticated;
grant select, insert, update, delete on table public.listings to service_role;

comment on table public.listings is
  'Provider-agnostic external listings. Connection, Store and Organization binding is enforced by a composite foreign key.';
