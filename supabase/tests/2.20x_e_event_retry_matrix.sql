\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception '2.20X-E assertion failed: %', message; end if;
end;
$$;

insert into public.stores (id, organization_id, name, status) values
  ('80000000-0000-4000-8000-000000000101', 'org_220x_e', 'Store X-E', 'active');

insert into public.connections (
  id, organization_id, store_id, provider, external_account_id, status
) values
  ('80000000-0000-4000-8000-000000000201', 'org_220x_e',
   '80000000-0000-4000-8000-000000000101', 'mercado-libre', '123', 'active');

insert into public.integration_events (
  id, organization_id, store_id, connection_id, provider, topic, resource,
  external_resource_id, dedupe_key, provider_user_id, application_id,
  provider_sent_at, delivery_attempts
)
select
  ('80000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'org_220x_e', '80000000-0000-4000-8000-000000000101',
  '80000000-0000-4000-8000-000000000201', 'mercado-libre', 'items',
  '/items/MLA' || (100 + value)::text, 'MLA' || (100 + value)::text,
  repeat(substr('abcdef01', value, 1), 64), '123', '456', now(), 1
from generate_series(1, 6) as value;

select pg_temp.assert_true(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'integration_events'
      and column_name = 'next_retry_at' and data_type = 'timestamp with time zone'
  ),
  'next_retry_at schema'
);
\echo 'A retry schema: PASS'

do $$
declare failure text;
declare scheduled_at timestamptz;
declare delay_seconds numeric;
begin
  perform * from public.claim_integration_event_processing(
    '80000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001'
  );
  select public.fail_integration_event_processing(
    '80000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'provider_timeout', 'Provider request timed out', true, null
  ) into failure;
  select next_retry_at into scheduled_at from public.integration_events
  where id = '80000000-0000-4000-8000-000000000001';
  delay_seconds := extract(epoch from scheduled_at - now());
  perform pg_temp.assert_true(
    failure = 'retry_scheduled' and delay_seconds between 30 and 37,
    'transient failure deterministic bounded backoff'
  );
end;
$$;
\echo 'B transient schedules bounded retry: PASS'

do $$
declare claim_result record;
declare before_attempts integer;
begin
  select processing_attempts into before_attempts from public.integration_events
  where id = '80000000-0000-4000-8000-000000000001';
  perform pg_temp.assert_true(
    not exists (
      select 1 from public.list_due_integration_event_retries(10)
      where event_id = '80000000-0000-4000-8000-000000000001'
    ),
    'not due excluded'
  );
  select * into claim_result from public.claim_integration_event_processing(
    '80000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000002'
  );
  perform pg_temp.assert_true(
    claim_result.outcome = 'not_yet_due'
      and (select processing_attempts = before_attempts from public.integration_events
           where id = '80000000-0000-4000-8000-000000000001'),
    'not due claim denied without attempt'
  );
end;
$$;
\echo 'C not-due selection and claim DENY: PASS'

update public.integration_events
set next_retry_at = now() - interval '1 second'
where id = '80000000-0000-4000-8000-000000000001';

update public.integration_events
set status = 'processed', processed_at = now()
where id = '80000000-0000-4000-8000-000000000002';

update public.integration_events
set status = 'failed', retryable = false,
    safe_error_code = 'resource_not_found',
    safe_error_summary = 'Provider resource was not found'
where id = '80000000-0000-4000-8000-000000000003';

do $$
begin
  perform * from public.claim_integration_event_processing(
    '80000000-0000-4000-8000-000000000004',
    '81000000-0000-4000-8000-000000000004'
  );
  perform pg_temp.assert_true(
    (select array_agg(event_id order by event_id) = array[
      '80000000-0000-4000-8000-000000000001'::uuid
    ] from public.list_due_integration_event_retries(10)),
    'only due retry selected'
  );
end;
$$;
\echo 'D due selected; processed/permanent/leased excluded: PASS'

do $$
declare first_claim record;
declare second_claim record;
begin
  select * into first_claim from public.claim_integration_event_processing(
    '80000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000005'
  );
  select * into second_claim from public.claim_integration_event_processing(
    '80000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000006'
  );
  perform pg_temp.assert_true(
    first_claim.outcome = 'claimed' and first_claim.processing_attempts = 2
      and second_claim.outcome = 'already_processing'
      and second_claim.processing_attempts = 2,
    'single retry claim and attempt'
  );
end;
$$;
\echo 'E retry claim and double-dispatch CAS: PASS'

do $$
declare provider_floor timestamptz := now() + interval '10 minutes';
declare scheduled_at timestamptz;
begin
  perform * from public.claim_integration_event_processing(
    '80000000-0000-4000-8000-000000000005',
    '81000000-0000-4000-8000-000000000007'
  );
  perform public.fail_integration_event_processing(
    '80000000-0000-4000-8000-000000000005',
    '81000000-0000-4000-8000-000000000007',
    'provider_rate_limited', 'Provider rate limit exhausted', true, provider_floor
  );
  select next_retry_at into scheduled_at from public.integration_events
  where id = '80000000-0000-4000-8000-000000000005';
  perform pg_temp.assert_true(scheduled_at >= provider_floor, 'Retry-After lower bound');
end;
$$;
\echo 'F Retry-After respected: PASS'

do $$
declare failure text;
begin
  update public.integration_events set processing_attempts = 4
  where id = '80000000-0000-4000-8000-000000000006';
  perform * from public.claim_integration_event_processing(
    '80000000-0000-4000-8000-000000000006',
    '81000000-0000-4000-8000-000000000008'
  );
  select public.fail_integration_event_processing(
    '80000000-0000-4000-8000-000000000006',
    '81000000-0000-4000-8000-000000000008',
    'provider_timeout', 'Provider request timed out', true, null
  ) into failure;
  perform pg_temp.assert_true(
    failure = 'retry_exhausted'
      and (select status = 'failed' and retryable is false and next_retry_at is null
             and safe_error_code = 'retry_exhausted'
           from public.integration_events
           where id = '80000000-0000-4000-8000-000000000006'),
    'max attempts terminal'
  );
end;
$$;
\echo 'G max attempts terminalizes: PASS'

select pg_temp.assert_true(
  not has_function_privilege(
    'public',
    'public.list_due_integration_event_retries(integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.list_due_integration_event_retries(integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.list_due_integration_event_retries(integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.list_due_integration_event_retries(integer)',
    'EXECUTE'
  ),
  'retry RPC grants'
);
\echo 'H server-only retry RPC: PASS'

rollback;
