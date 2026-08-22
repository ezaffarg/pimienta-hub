create extension if not exists pgcrypto;

create table public.hub_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clerk_user_id text not null,
  role text not null check (role in ('Owner', 'Manager', 'Employee', 'Client')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_memberships_organization_user_key
    unique (organization_id, clerk_user_id),
  constraint hub_memberships_id_organization_key
    unique (id, organization_id)
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  name text not null check (btrim(name) <> ''),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_id_organization_key unique (id, organization_id)
);

create index stores_organization_status_idx
  on public.stores (organization_id, status);

create table public.store_assignments (
  membership_id uuid not null,
  store_id uuid not null,
  organization_id text not null,
  created_at timestamptz not null default now(),
  constraint store_assignments_pkey primary key (membership_id, store_id),
  constraint store_assignments_membership_organization_fkey
    foreign key (membership_id, organization_id)
    references public.hub_memberships (id, organization_id)
    on delete restrict,
  constraint store_assignments_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict
);

create index store_assignments_store_membership_idx
  on public.store_assignments (store_id, membership_id);

comment on table public.store_assignments is
  'Explicit Store Scope; composite foreign keys prevent cross-tenant assignments.';

comment on column public.hub_memberships.role is
  'Definitive e-Hub role for a Clerk user within an Organization.';

comment on schema public is
  'RLS is deliberately deferred; server-side tenant-scoped queries and constraints are the current defense.';
