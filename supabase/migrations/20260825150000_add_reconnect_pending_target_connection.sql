-- Bind future reconnect pendings to their server-resolved connection target.

alter table public.oauth_pending_authorizations
  add column target_connection_id uuid;

alter table public.oauth_pending_authorizations
  add constraint oauth_pending_authorizations_target_connection_fkey
  foreign key (target_connection_id)
  references public.connections (id)
  on delete restrict;

-- NOT VALID preserves legacy reconnect pendings without backfilling them, while
-- enforcing the definitive invariant for every row written after this migration.
alter table public.oauth_pending_authorizations
  add constraint oauth_pending_authorizations_reconnect_target_check
  check (purpose <> 'reconnect' or target_connection_id is not null) not valid;
