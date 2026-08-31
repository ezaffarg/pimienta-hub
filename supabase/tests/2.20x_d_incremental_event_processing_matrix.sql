\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception '2.20X-D assertion failed: %', message; end if;
end;
$$;

create function pg_temp.item_payload(updated_at timestamptz, item_title text, item_status text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'external_listing_id', 'MLA100',
    'title', item_title,
    'status', item_status,
    'price', '20',
    'currency_id', 'ARS',
    'available_quantity', 2,
    'sold_quantity', 1,
    'seller_sku', null,
    'listing_type_id', 'gold',
    'condition', 'new',
    'permalink', null,
    'thumbnail_url', null,
    'catalog_product_id', null,
    'provider_created_at', '2026-08-28T09:00:00Z',
    'provider_updated_at', updated_at
  );
$$;

insert into public.hub_memberships (id, organization_id, clerk_user_id, role) values
  ('70000000-0000-4000-8000-000000000001', 'org_220x_a', 'owner_xd_a', 'Owner'),
  ('70000000-0000-4000-8000-000000000002', 'org_220x_b', 'owner_xd_b', 'Owner');

insert into public.stores (id, organization_id, name, status) values
  ('70000000-0000-4000-8000-000000000101', 'org_220x_a', 'X-D A', 'active'),
  ('70000000-0000-4000-8000-000000000102', 'org_220x_b', 'X-D B', 'active');

insert into public.connections (
  id, organization_id, store_id, provider, external_account_id, status
) values
  ('70000000-0000-4000-8000-000000000201', 'org_220x_a', '70000000-0000-4000-8000-000000000101', 'mercado-libre', '123', 'active'),
  ('70000000-0000-4000-8000-000000000202', 'org_220x_b', '70000000-0000-4000-8000-000000000102', 'mercado-libre', '999', 'active'),
  ('70000000-0000-4000-8000-000000000203', 'org_220x_a', '70000000-0000-4000-8000-000000000101', 'mercado-libre', '124', 'disabled');

insert into public.listing_sync_runs (
  id, organization_id, store_id, connection_id, actor_membership_id, kind,
  idempotency_key, status, completed_at
) values (
  '70000000-0000-4000-8000-000000000401', 'org_220x_a',
  '70000000-0000-4000-8000-000000000101', '70000000-0000-4000-8000-000000000201',
  '70000000-0000-4000-8000-000000000001', 'listing_backfill',
  '70000000-0000-4000-8000-000000000402', 'succeeded', now()
);

insert into public.listings (
  id, organization_id, store_id, connection_id, external_listing_id, title,
  status, price, currency_id, available_quantity, sold_quantity, listing_type_id,
  condition, provider_created_at, provider_updated_at, last_synced_at,
  last_seen_sync_run_id
) values (
  '70000000-0000-4000-8000-000000000301', 'org_220x_a',
  '70000000-0000-4000-8000-000000000101', '70000000-0000-4000-8000-000000000201',
  'MLA100', 'Original', 'active', 10, 'ARS', 1, 0, 'gold', 'new',
  '2026-08-28T09:00:00Z', '2026-08-28T10:00:00Z', '2026-08-28T10:00:00Z',
  '70000000-0000-4000-8000-000000000401'
);

insert into public.integration_events (
  id, organization_id, store_id, connection_id, provider, topic, resource,
  external_resource_id, dedupe_key, provider_user_id, application_id,
  provider_sent_at, delivery_attempts
)
select
  ('70000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'org_220x_a', '70000000-0000-4000-8000-000000000101',
  '70000000-0000-4000-8000-000000000201', 'mercado-libre', 'items',
  '/items/MLA100', 'MLA100', repeat(substr('abcdef0123456789', value, 1), 64),
  '123', '456', now(), 1
from generate_series(1, 8) as value;

insert into public.integration_events (
  id, organization_id, store_id, connection_id, provider, topic, resource,
  external_resource_id, dedupe_key, provider_user_id, application_id,
  provider_sent_at, delivery_attempts
) values (
  '70000000-0000-4000-8000-000000000009', 'org_220x_a',
  '70000000-0000-4000-8000-000000000101', '70000000-0000-4000-8000-000000000203',
  'mercado-libre', 'items', '/items/MLA900', 'MLA900', repeat('9', 64),
  '124', '456', now(), 1
);

select pg_temp.assert_true(
  (select count(*) = 5 from information_schema.columns
   where table_schema = 'public' and table_name = 'integration_events'
     and column_name in (
       'processing_attempts', 'processing_lease_id', 'processing_lease_expires_at',
       'retryable', 'safe_error_summary'
     )),
  'processing lifecycle columns'
);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.fail_integration_event_processing(
      '70000000-0000-4000-8000-000000000001', null,
      'provider_timeout', 'Provider request timed out', true
    );
  exception when others then
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected, 'null lease rejected');
end;
$$;
\echo 'A processing lifecycle schema and input guard: PASS'

do $$
declare claimed record;
begin
  select * into claimed from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001'
  );
  perform pg_temp.assert_true(
    claimed.outcome = 'claimed' and claimed.processing_attempts = 1,
    'first claim'
  );
end;
$$;
\echo 'B received to claimed: PASS'

do $$
declare completed record;
begin
  select * into completed from public.complete_integration_event_listing(
    '70000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001', now(),
    pg_temp.item_payload('2026-08-28T11:00:00Z', 'New', 'paused')
  );
  perform pg_temp.assert_true(completed.outcome = 'applied', 'newer apply');
end;
$$;
select pg_temp.assert_true(
  (select id = '70000000-0000-4000-8000-000000000301'
     and title = 'New' and status = 'paused'
     and provider_updated_at = '2026-08-28T11:00:00Z'
     and last_seen_sync_run_id = '70000000-0000-4000-8000-000000000401'
   from public.listings where external_listing_id = 'MLA100')
  and (select status = 'processed' and processed_at is not null
       and processing_lease_id is null
       from public.integration_events where id = '70000000-0000-4000-8000-000000000001'),
  'atomic listing apply and event success'
);
\echo 'C newer APPLY and processed atomically: PASS'

select pg_temp.assert_true(
  (select outcome = 'already_processed' from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000002'
  )),
  'processed cannot reclaim'
);
\echo 'D processed reclaim denied: PASS'

do $$
declare first_claim record;
declare second_claim record;
declare completed record;
begin
  select * into first_claim from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000003'
  );
  select * into second_claim from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000004'
  );
  perform pg_temp.assert_true(
    first_claim.outcome = 'claimed' and second_claim.outcome = 'already_processing',
    'double claim denied'
  );
  select * into completed from public.complete_integration_event_listing(
    '70000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000003', now(),
    pg_temp.item_payload('2026-08-28T09:00:00Z', 'Old', 'active')
  );
  perform pg_temp.assert_true(completed.outcome = 'stale_noop', 'older stale noop');
end;
$$;
select pg_temp.assert_true(
  (select title = 'New' and status = 'paused'
   from public.listings where external_listing_id = 'MLA100'),
  'stale payload did not degrade listing'
);
\echo 'E double claim DENY and older STALE_NOOP: PASS'

do $$
declare completed record;
begin
  perform * from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000003',
    '71000000-0000-4000-8000-000000000005'
  );
  select * into completed from public.complete_integration_event_listing(
    '70000000-0000-4000-8000-000000000003',
    '71000000-0000-4000-8000-000000000005', now(),
    pg_temp.item_payload('2026-08-28T11:00:00Z', 'New', 'paused')
  );
  perform pg_temp.assert_true(completed.outcome = 'equivalent_noop', 'equal equivalent');
end;
$$;
\echo 'F equal EQUIVALENT_NOOP: PASS'

do $$
declare completed record;
declare failure text;
begin
  perform * from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000004',
    '71000000-0000-4000-8000-000000000006'
  );
  select * into completed from public.complete_integration_event_listing(
    '70000000-0000-4000-8000-000000000004',
    '71000000-0000-4000-8000-000000000006', now(),
    pg_temp.item_payload('2026-08-28T11:00:00Z', 'Conflict', 'paused')
  );
  perform pg_temp.assert_true(completed.outcome = 'freshness_conflict', 'equal conflict');
  select public.fail_integration_event_processing(
    '70000000-0000-4000-8000-000000000004',
    '71000000-0000-4000-8000-000000000006',
    'ambiguous_provider_timestamp', 'Provider freshness evidence is invalid', false
  ) into failure;
  perform pg_temp.assert_true(failure = 'failed', 'conflict fail closed');
end;
$$;
select pg_temp.assert_true(
  (select title = 'New' from public.listings where external_listing_id = 'MLA100')
  and (select status = 'failed' and retryable is false
       from public.integration_events where id = '70000000-0000-4000-8000-000000000004'),
  'conflict preserved listing and failed event'
);
\echo 'G equal conflict FAIL_CLOSED: PASS'

do $$
begin
  perform * from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000005',
    '71000000-0000-4000-8000-000000000007'
  );
  begin
    perform * from public.complete_integration_event_listing(
      '70000000-0000-4000-8000-000000000005',
      '71000000-0000-4000-8000-000000000007', now(),
      pg_temp.item_payload(null, 'Missing timestamp', 'active')
    );
    raise exception 'expected missing timestamp rejection';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.fail_integration_event_processing(
    '70000000-0000-4000-8000-000000000005',
    '71000000-0000-4000-8000-000000000007',
    'ambiguous_provider_timestamp', 'Provider freshness evidence is invalid', false
  );
end;
$$;
\echo 'H missing provider timestamp FAIL_CLOSED: PASS'

update public.listings
set reconciliation_state = 'missing_candidate', not_seen_since = now(),
    consecutive_not_seen_count = 2
where external_listing_id = 'MLA100';
do $$
declare completed record;
begin
  perform * from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000006',
    '71000000-0000-4000-8000-000000000008'
  );
  select * into completed from public.complete_integration_event_listing(
    '70000000-0000-4000-8000-000000000006',
    '71000000-0000-4000-8000-000000000008', now(),
    pg_temp.item_payload('2026-08-28T12:00:00Z', 'Returned', 'active')
  );
  perform pg_temp.assert_true(completed.outcome = 'applied', 'positive return applied');
end;
$$;
select pg_temp.assert_true(
  (select reconciliation_state = 'seen' and not_seen_since is null
     and consecutive_not_seen_count = 0
     and last_seen_sync_run_id = '70000000-0000-4000-8000-000000000401'
   from public.listings where external_listing_id = 'MLA100'),
  'positive reappearance preserves run evidence'
);
\echo 'I positive reappearance semantics: PASS'

do $$
declare first_claim record;
declare reclaimed record;
declare expired_failure text;
begin
  select * into first_claim from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000007',
    '71000000-0000-4000-8000-000000000009'
  );
  update public.integration_events set processing_lease_expires_at = now() - interval '1 second'
  where id = '70000000-0000-4000-8000-000000000007';
  select public.fail_integration_event_processing(
    '70000000-0000-4000-8000-000000000007',
    '71000000-0000-4000-8000-000000000009',
    'provider_timeout', 'Provider request timed out', true
  ) into expired_failure;
  select * into reclaimed from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000007',
    '71000000-0000-4000-8000-000000000010'
  );
  perform pg_temp.assert_true(
    first_claim.outcome = 'claimed' and expired_failure = 'lease_lost'
      and reclaimed.outcome = 'claimed'
      and reclaimed.processing_attempts = 2,
    'expired lease reclaim'
  );
end;
$$;
\echo 'J expired lease reclaim and attempt semantics: PASS'

do $$
declare failure text;
declare retry_claim record;
begin
  perform * from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000008',
    '71000000-0000-4000-8000-000000000011'
  );
  select public.fail_integration_event_processing(
    '70000000-0000-4000-8000-000000000008',
    '71000000-0000-4000-8000-000000000011',
    'provider_timeout', 'Provider request timed out', true
  ) into failure;
  update public.integration_events set next_retry_at = now() - interval '1 second'
  where id = '70000000-0000-4000-8000-000000000008';
  select * into retry_claim from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000008',
    '71000000-0000-4000-8000-000000000012'
  );
  perform pg_temp.assert_true(
    failure = 'retry_scheduled' and retry_claim.outcome = 'claimed'
      and retry_claim.processing_attempts = 2,
    'retryable failure reclaim'
  );
end;
$$;
\echo 'K retryable failure is not processed and reclaims once: PASS'

do $$
declare claim_result record;
declare failed_permanently boolean;
begin
  select * into claim_result from public.claim_integration_event_processing(
    '70000000-0000-4000-8000-000000000009',
    '71000000-0000-4000-8000-000000000013'
  );
  select status = 'failed' and retryable is false into failed_permanently
  from public.integration_events
  where id = '70000000-0000-4000-8000-000000000009';
  perform pg_temp.assert_true(
    claim_result.outcome = 'binding_invalid' and failed_permanently,
    'disabled connection binding denied'
  );
end;
$$;
\echo 'L wrong Connection DENY: PASS'

do $$
begin
  begin
    insert into public.integration_events (
      organization_id, store_id, connection_id, provider, topic, resource,
      external_resource_id, dedupe_key, provider_user_id, application_id,
      provider_sent_at, delivery_attempts
    ) values (
      'org_220x_b', '70000000-0000-4000-8000-000000000101',
      '70000000-0000-4000-8000-000000000201', 'mercado-libre', 'items',
      '/items/MLA999', 'MLA999', repeat('f', 63) || 'e', '123', '456', now(), 1
    );
    raise exception 'expected cross-tenant rejection';
  exception when foreign_key_violation then null;
  end;
end;
$$;
\echo 'M cross-tenant FK DENY: PASS'

select pg_temp.assert_true(
  (select count(*) = 1 from public.listings
   where connection_id = '70000000-0000-4000-8000-000000000201'
     and external_listing_id = 'MLA100'),
  'single listing row'
);
\echo 'N no duplicate Listing rows: PASS'

select pg_temp.assert_true(
  not has_function_privilege('public', 'public.claim_integration_event_processing(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_integration_event_processing(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_integration_event_processing(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.complete_integration_event_listing(uuid,uuid,timestamptz,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.fail_integration_event_processing(uuid,uuid,text,text,boolean,timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_integration_event_processing(uuid,uuid)', 'EXECUTE'),
  'RPC grants'
);
\echo 'O PUBLIC/browser denied and service_role allowed: PASS'

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.integration_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.integration_events', 'UPDATE'),
  'browser table denied'
);
\echo 'P browser privileged access DENY: PASS'

rollback;
