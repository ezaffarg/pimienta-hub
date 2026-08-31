import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ExternalListingSummary, IntegrationProvider } from '@/integrations/core';
import { getSupabaseServerClient } from './supabase-server';
import { listingPersistenceRow, PersistenceError, type ListingScope } from './repositories';

export type IntegrationEventClaimOutcome =
  | 'CLAIMED'
  | 'ALREADY_PROCESSED'
  | 'ALREADY_PROCESSING'
  | 'NOT_YET_DUE'
  | 'NOT_RETRYABLE'
  | 'BINDING_INVALID'
  | 'NOT_FOUND';
export type IntegrationEventFreshnessOutcome =
  | 'APPLY'
  | 'STALE_NOOP'
  | 'EQUIVALENT_NOOP'
  | 'FRESHNESS_CONFLICT';
export type IntegrationEventFailureOutcome =
  | 'FAILED'
  | 'RETRY_SCHEDULED'
  | 'RETRY_EXHAUSTED'
  | 'ALREADY_PROCESSED'
  | 'LEASE_LOST'
  | 'NOT_FOUND';
export type IntegrationEventSafeErrorCode =
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'invalid_provider_response'
  | 'persistence_failure'
  | 'resource_not_found'
  | 'ambiguous_provider_timestamp'
  | 'connection_binding_invalid'
  | 'retry_exhausted';

export interface ClaimedIntegrationEvent extends ListingScope {
  id: string;
  provider: IntegrationProvider;
  topic: string;
  resource: string;
  externalResourceId: string;
  providerUserId: string;
  processingAttempts: number;
  leaseExpiresAt: string;
}

export type IntegrationEventClaimResult =
  | { outcome: 'CLAIMED'; event: ClaimedIntegrationEvent }
  | { outcome: Exclude<IntegrationEventClaimOutcome, 'CLAIMED'>; event: null };

export class IntegrationEventProcessingRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServerClient()) {}

  async claim(eventId: string, leaseId: string): Promise<IntegrationEventClaimResult> {
    const parsed = eventLeaseSchema.parse({ eventId, leaseId });
    const response = await safeRpc(() =>
      this.client.rpc('claim_integration_event_processing', {
        p_event_id: parsed.eventId,
        p_lease_id: parsed.leaseId
      })
    );
    const rows = claimRowsSchema.safeParse(response.data);
    if (!rows.success) throw new PersistenceError('Integration event claim response invalid');
    const row = rows.data[0];
    const outcome = claimOutcome(row.outcome);
    if (outcome !== 'CLAIMED') return { outcome, event: null };
    const claimed = claimedEventSchema.safeParse(row);
    if (!claimed.success) throw new PersistenceError('Claimed integration event invalid');
    return {
      outcome,
      event: {
        id: claimed.data.event_id,
        organizationId: claimed.data.organization_id,
        storeId: claimed.data.store_id,
        connectionId: claimed.data.connection_id,
        provider: claimed.data.provider,
        topic: claimed.data.topic,
        resource: claimed.data.resource,
        externalResourceId: claimed.data.external_resource_id,
        providerUserId: claimed.data.provider_user_id,
        processingAttempts: claimed.data.processing_attempts,
        leaseExpiresAt: claimed.data.lease_expires_at
      }
    };
  }

  async completeListing(input: {
    eventId: string;
    leaseId: string;
    scope: ListingScope;
    listing: ExternalListingSummary;
    syncedAt: string;
  }): Promise<IntegrationEventFreshnessOutcome> {
    const ids = eventLeaseSchema.parse({ eventId: input.eventId, leaseId: input.leaseId });
    const syncedAt = z.iso.datetime().parse(input.syncedAt);
    const listing = listingPersistenceRow(input.scope, input.listing, syncedAt);
    if (listing.provider_updated_at === null) {
      throw new PersistenceError('Integration event listing timestamp missing');
    }
    const response = await safeRpc(() =>
      this.client.rpc('complete_integration_event_listing', {
        p_event_id: ids.eventId,
        p_lease_id: ids.leaseId,
        p_synced_at: syncedAt,
        p_listing: listing
      })
    );
    const rows = completionRowsSchema.safeParse(response.data);
    if (!rows.success) throw new PersistenceError('Integration event completion response invalid');
    return freshnessOutcome(rows.data[0].outcome);
  }

  async fail(input: {
    eventId: string;
    leaseId: string;
    errorCode: IntegrationEventSafeErrorCode;
    errorSummary: string;
    retryable: boolean;
    retryAfterAt?: string | null;
  }): Promise<IntegrationEventFailureOutcome> {
    const parsed = failureInputSchema.parse(input);
    const response = await safeRpc(() =>
      this.client.rpc('fail_integration_event_processing', {
        p_event_id: parsed.eventId,
        p_lease_id: parsed.leaseId,
        p_error_code: parsed.errorCode,
        p_error_summary: parsed.errorSummary,
        p_retryable: parsed.retryable,
        p_retry_after_at: parsed.retryAfterAt ?? null
      })
    );
    const outcome = failureOutcomeSchema.safeParse(response.data);
    if (!outcome.success) throw new PersistenceError('Integration event failure response invalid');
    return failureOutcome(outcome.data);
  }

  async listDueRetries(limit: number): Promise<readonly string[]> {
    const parsedLimit = z.number().int().min(1).max(100).parse(limit);
    const response = await safeRpc(() =>
      this.client.rpc('list_due_integration_event_retries', { p_limit: parsedLimit })
    );
    const rows = dueRetryRowsSchema.safeParse(response.data);
    if (!rows.success) throw new PersistenceError('Due integration event retries invalid');
    return rows.data.map((row) => row.event_id);
  }

  async listReceivedForConnection(connectionId: string, limit: number): Promise<readonly string[]> {
    return this.listForConnection(
      'list_received_integration_events_for_connection',
      connectionId,
      limit
    );
  }

  async listDueRetriesForConnection(
    connectionId: string,
    limit: number
  ): Promise<readonly string[]> {
    return this.listForConnection(
      'list_due_integration_event_retries_for_connection',
      connectionId,
      limit
    );
  }

  private async listForConnection(
    rpcName:
      | 'list_received_integration_events_for_connection'
      | 'list_due_integration_event_retries_for_connection',
    connectionId: string,
    limit: number
  ): Promise<readonly string[]> {
    const parsed = z
      .object({ connectionId: z.uuid(), limit: z.number().int().min(1).max(100) })
      .strict()
      .parse({ connectionId, limit });
    const response = await safeRpc(() =>
      this.client.rpc(rpcName, {
        p_connection_id: parsed.connectionId,
        p_limit: parsed.limit
      })
    );
    const rows = dueRetryRowsSchema.safeParse(response.data);
    if (!rows.success) throw new PersistenceError('Integration event selection invalid');
    return rows.data.map((row) => row.event_id);
  }
}

const eventLeaseSchema = z.object({ eventId: z.uuid(), leaseId: z.uuid() }).strict();
const safeErrorCodeSchema = z.enum([
  'provider_rate_limited',
  'provider_timeout',
  'provider_unavailable',
  'invalid_provider_response',
  'persistence_failure',
  'resource_not_found',
  'ambiguous_provider_timestamp',
  'connection_binding_invalid',
  'retry_exhausted'
]);
const failureInputSchema = eventLeaseSchema
  .extend({
    errorCode: safeErrorCodeSchema,
    errorSummary: z.string().trim().min(1).max(255),
    retryable: z.boolean(),
    retryAfterAt: z.iso.datetime({ offset: true }).nullable().optional()
  })
  .strict();
const nullableClaimRowSchema = z.object({
  outcome: z.string(),
  event_id: z.uuid().nullable(),
  organization_id: z.string().nullable(),
  store_id: z.uuid().nullable(),
  connection_id: z.uuid().nullable(),
  provider: z.string().nullable(),
  topic: z.string().nullable(),
  resource: z.string().nullable(),
  external_resource_id: z.string().nullable(),
  provider_user_id: z.string().nullable(),
  processing_attempts: z.number().int().nonnegative().nullable(),
  lease_expires_at: z.iso.datetime({ offset: true }).nullable()
});
const claimRowsSchema = z.array(nullableClaimRowSchema).length(1);
const claimedEventSchema = nullableClaimRowSchema.extend({
  event_id: z.uuid(),
  organization_id: z.string().trim().min(1).max(255),
  store_id: z.uuid(),
  connection_id: z.uuid(),
  provider: z.enum(['mercado-libre', 'shopify', 'tiendanube', 'woocommerce']),
  topic: z.string().trim().min(1),
  resource: z.string().trim().min(1),
  external_resource_id: z.string().trim().min(1),
  provider_user_id: z.string().trim().min(1),
  processing_attempts: z.number().int().positive(),
  lease_expires_at: z.iso.datetime({ offset: true })
});
const completionRowsSchema = z
  .array(z.object({ outcome: z.string(), listing_id: z.uuid() }))
  .length(1);
const failureOutcomeSchema = z.enum([
  'failed',
  'retry_scheduled',
  'retry_exhausted',
  'already_processed',
  'lease_lost',
  'not_found'
]);
const dueRetryRowsSchema = z.array(z.object({ event_id: z.uuid() })).max(100);

function claimOutcome(value: string): IntegrationEventClaimOutcome {
  return z
    .enum([
      'claimed',
      'already_processed',
      'already_processing',
      'not_yet_due',
      'not_retryable',
      'binding_invalid',
      'not_found'
    ])
    .transform((outcome) => outcome.toUpperCase() as IntegrationEventClaimOutcome)
    .parse(value);
}

function freshnessOutcome(value: string): IntegrationEventFreshnessOutcome {
  return z
    .enum(['applied', 'stale_noop', 'equivalent_noop', 'freshness_conflict'])
    .transform((outcome) =>
      outcome === 'applied' ? 'APPLY' : (outcome.toUpperCase() as IntegrationEventFreshnessOutcome)
    )
    .parse(value);
}

function failureOutcome(
  value: z.infer<typeof failureOutcomeSchema>
): IntegrationEventFailureOutcome {
  return value.toUpperCase() as IntegrationEventFailureOutcome;
}

async function safeRpc(
  operation: () => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ data: unknown }> {
  let response;
  try {
    response = await operation();
  } catch {
    throw new PersistenceError('Integration event processing RPC failed');
  }
  if (response.error) throw new PersistenceError('Integration event processing failed');
  return response;
}
