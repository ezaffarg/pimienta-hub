create table public.connections (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  store_id uuid not null,
  provider text not null check (provider in ('mercado-libre', 'shopify', 'tiendanube', 'woocommerce')),
  external_account_id text,
  status text not null default 'disabled' check (status in ('active', 'disabled')),
  scopes text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connections_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict
);

create index connections_organization_store_idx
  on public.connections (organization_id, store_id);

create index connections_organization_provider_idx
  on public.connections (organization_id, provider);

create unique index connections_active_provider_account_key
  on public.connections (provider, external_account_id)
  where external_account_id is not null and status = 'active';

comment on table public.connections is
  'Provider-agnostic Store connection metadata. OAuth tokens and secrets are deliberately excluded.';
