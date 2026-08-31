\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception '2.20X-B assertion failed: %', message; end if;
end;
$$;

insert into public.hub_memberships (id, organization_id, clerk_user_id, role) values
  ('60000000-0000-4000-8000-000000000001', 'org_220x_a', 'owner_220x_a', 'Owner'),
  ('60000000-0000-4000-8000-000000000002', 'org_220x_b', 'owner_220x_b', 'Owner');

insert into public.stores (id, organization_id, name, status) values
  ('60000000-0000-4000-8000-000000000101', 'org_220x_a', 'X A1', 'active'),
  ('60000000-0000-4000-8000-000000000102', 'org_220x_a', 'X A2', 'active'),
  ('60000000-0000-4000-8000-000000000103', 'org_220x_b', 'X B1', 'active');

insert into public.connections (
  id, organization_id, store_id, provider, external_account_id, status
) values
  ('60000000-0000-4000-8000-000000000201', 'org_220x_a', '60000000-0000-4000-8000-000000000101', 'mercado-libre', '123', 'active'),
  ('60000000-0000-4000-8000-000000000202', 'org_220x_a', '60000000-0000-4000-8000-000000000102', 'mercado-libre', '124', 'active'),
  ('60000000-0000-4000-8000-000000000203', 'org_220x_b', '60000000-0000-4000-8000-000000000103', 'mercado-libre', '125', 'active'),
  ('60000000-0000-4000-8000-000000000204', 'org_220x_a', '60000000-0000-4000-8000-000000000101', 'shopify', '126', 'active');

select pg_temp.assert_true(
  (select count(*) >= 21 from information_schema.columns
   where table_schema = 'public' and table_name = 'integration_events')
  and exists (
    select 1 from pg_constraint
    where conname = 'integration_events_connection_scope_fkey'
  )
  and exists (
    select 1 from pg_constraint
    where conname = 'integration_events_lifecycle_check'
  ),
  'schema and constraints'
);
\echo 'A schema and constraints: PASS'

do $$
declare first_result record;
declare duplicate_result record;
begin
  select * into first_result from public.intake_integration_event(
    'org_220x_a', '60000000-0000-4000-8000-000000000101',
    '60000000-0000-4000-8000-000000000201', 'mercado-libre', 'items',
    '/items/MLA123456', 'MLA123456', 'event-1', repeat('a', 64), '123', '456',
    '2026-08-28T12:00:00Z', '2026-08-28T12:00:01Z', 1
  );
  select * into duplicate_result from public.intake_integration_event(
    'org_220x_a', '60000000-0000-4000-8000-000000000101',
    '60000000-0000-4000-8000-000000000201', 'mercado-libre', 'items',
    '/items/MLA123456', 'MLA123456', 'event-1', repeat('a', 64), '123', '456',
    '2026-08-28T12:00:00Z', '2026-08-28T13:00:00Z', 8
  );
  perform pg_temp.assert_true(
    first_result.outcome = 'accepted'
    and duplicate_result.outcome = 'duplicate'
    and first_result.id = duplicate_result.id,
    'controlled intake outcomes'
  );
end;
$$;
select pg_temp.assert_true(
  (select count(*) = 1 and min(organization_id) = 'org_220x_a'
   from public.integration_events where dedupe_key = repeat('a', 64)),
  'one row with immutable scope'
);
\echo 'B atomic ACCEPTED then DUPLICATE: PASS'

do $$
begin
  begin
    insert into public.integration_events (
      organization_id, store_id, connection_id, provider, topic, resource,
      external_resource_id, external_event_id, dedupe_key, provider_user_id,
      application_id, provider_sent_at, delivery_attempts
    ) values (
      'org_220x_a', '60000000-0000-4000-8000-000000000101',
      '60000000-0000-4000-8000-000000000201', 'mercado-libre', 'items',
      '/items/MLA123456', 'MLA123456', 'event-copy', repeat('a', 64), '123', '456', now(), 1
    );
    raise exception 'expected unique rejection';
  exception when unique_violation then null;
  end;
end;
$$;
\echo 'C provider/application/dedupe uniqueness: PASS'

do $$
begin
  begin
    insert into public.integration_events (
      organization_id, store_id, connection_id, provider, topic, resource,
      external_resource_id, dedupe_key, provider_user_id, application_id,
      provider_sent_at, delivery_attempts
    ) values (
      'org_220x_b', '60000000-0000-4000-8000-000000000101',
      '60000000-0000-4000-8000-000000000201', 'mercado-libre', 'items',
      '/items/MLA222222', 'MLA222222', repeat('b', 64), '123', '456', now(), 1
    );
    raise exception 'expected cross-Organization rejection';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.integration_events (
      organization_id, store_id, connection_id, provider, topic, resource,
      external_resource_id, dedupe_key, provider_user_id, application_id,
      provider_sent_at, delivery_attempts
    ) values (
      'org_220x_a', '60000000-0000-4000-8000-000000000102',
      '60000000-0000-4000-8000-000000000201', 'mercado-libre', 'items',
      '/items/MLA222222', 'MLA222222', repeat('b', 64), '123', '456', now(), 1
    );
    raise exception 'expected cross-Store rejection';
  exception when foreign_key_violation then null;
  end;
end;
$$;
\echo 'D cross-Organization and cross-Store FK protection: PASS'

do $$
begin
  begin
    perform * from public.intake_integration_event(
      'org_220x_a', '60000000-0000-4000-8000-000000000101',
      '60000000-0000-4000-8000-000000000201', 'mercado-libre', 'items',
      '/items/MLA333333', 'MLA333333', null, repeat('c', 64), '124', '456', now(), null, 1
    );
    raise exception 'expected cross-Connection identity rejection';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform * from public.intake_integration_event(
      'org_220x_a', '60000000-0000-4000-8000-000000000101',
      '60000000-0000-4000-8000-000000000204', 'mercado-libre', 'items',
      '/items/MLA444444', 'MLA444444', null, repeat('d', 64), '126', '456', now(), null, 1
    );
    raise exception 'expected provider rejection';
  exception when sqlstate 'P0001' then null;
  end;
end;
$$;
\echo 'E cross-Connection identity and provider binding: PASS'

do $$
begin
  begin
    update public.integration_events set status = 'retrying'
    where dedupe_key = repeat('a', 64);
    raise exception 'expected invalid status rejection';
  exception when check_violation then null;
  end;
end;
$$;
\echo 'F invalid lifecycle status: PASS'

select pg_temp.assert_true(
  not has_function_privilege(
    'public',
    'public.intake_integration_event(text,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.intake_integration_event(text,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.intake_integration_event(text,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,integer)',
    'EXECUTE'
  ),
  'PUBLIC and browser roles cannot execute intake'
);
\echo 'G PUBLIC/browser RPC execute revoked: PASS'

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.integration_events', 'SELECT')
  and not has_table_privilege('anon', 'public.integration_events', 'INSERT')
  and not has_table_privilege('authenticated', 'public.integration_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.integration_events', 'INSERT'),
  'browser roles cannot access integration events'
);
\echo 'H browser privileged table access denied: PASS'

select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.intake_integration_event(text,uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,integer)',
    'EXECUTE'
  )
  and has_table_privilege('service_role', 'public.integration_events', 'SELECT')
  and has_table_privilege('service_role', 'public.integration_events', 'INSERT'),
  'service_role compatibility'
);
\echo 'I service_role compatibility: PASS'

rollback;
