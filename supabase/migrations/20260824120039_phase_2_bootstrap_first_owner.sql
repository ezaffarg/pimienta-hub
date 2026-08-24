create function public.bootstrap_first_owner(
  p_organization_id text,
  p_clerk_user_id text
)
returns table (outcome text, membership_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_owner_id uuid;
  existing_membership_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id, 0));

  select id into existing_owner_id
  from public.hub_memberships
  where organization_id = p_organization_id and role = 'Owner'
  limit 1;

  if found then
    return query select 'already_bootstrapped'::text, existing_owner_id;
    return;
  end if;

  select id into existing_membership_id
  from public.hub_memberships
  where organization_id = p_organization_id and clerk_user_id = p_clerk_user_id;

  if found then
    return query select 'membership_exists_non_owner'::text, existing_membership_id;
    return;
  end if;

  insert into public.hub_memberships (organization_id, clerk_user_id, role)
  values (p_organization_id, p_clerk_user_id, 'Owner')
  returning id into existing_owner_id;

  return query select 'created'::text, existing_owner_id;
end;
$$;

comment on function public.bootstrap_first_owner(text, text) is
  'Concurrency-safe initial Owner bootstrap. It serializes one Organization only and does not restrict future Owner cardinality.';
