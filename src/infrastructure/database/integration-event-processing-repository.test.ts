import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import { IntegrationEventProcessingRepository } from './integration-event-processing-repository';

const eventId = '10000000-0000-4000-8000-000000000001';
const leaseId = '10000000-0000-4000-8000-000000000002';
const scope = {
  organizationId: 'org_test',
  storeId: '10000000-0000-4000-8000-000000000003',
  connectionId: '10000000-0000-4000-8000-000000000004'
};
const summary = {
  externalId: 'MLA123456',
  title: 'Listing',
  status: 'active',
  price: 10,
  currency: 'ARS',
  availableQuantity: 2,
  soldQuantity: 1,
  listingType: 'gold',
  permalink: 'https://example.test/item',
  thumbnail: 'https://example.test/image.jpg',
  catalogProductId: null,
  sellerSku: 'SKU',
  condition: 'new',
  providerCreatedAt: '2026-08-28T10:00:00.000Z',
  providerUpdatedAt: '2026-08-28T11:00:00.000Z'
};

describe('IntegrationEventProcessingRepository', () => {
  it('maps a claimed event with persisted scope and attempt', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          outcome: 'claimed',
          event_id: eventId,
          organization_id: scope.organizationId,
          store_id: scope.storeId,
          connection_id: scope.connectionId,
          provider: 'mercado-libre',
          topic: 'items',
          resource: '/items/MLA123456',
          external_resource_id: 'MLA123456',
          provider_user_id: '123',
          processing_attempts: 1,
          lease_expires_at: '2026-08-28T12:05:00.000Z'
        }
      ],
      error: null
    });
    const repository = new IntegrationEventProcessingRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(repository.claim(eventId, leaseId)).resolves.toMatchObject({
      outcome: 'CLAIMED',
      event: { ...scope, processingAttempts: 1 }
    });
  });

  it.each([
    ['already_processed', 'ALREADY_PROCESSED'],
    ['already_processing', 'ALREADY_PROCESSING'],
    ['not_yet_due', 'NOT_YET_DUE'],
    ['not_retryable', 'NOT_RETRYABLE'],
    ['binding_invalid', 'BINDING_INVALID'],
    ['not_found', 'NOT_FOUND']
  ] as const)('maps controlled claim outcome %s', async (raw, outcome) => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          outcome: raw,
          event_id: null,
          organization_id: null,
          store_id: null,
          connection_id: null,
          provider: null,
          topic: null,
          resource: null,
          external_resource_id: null,
          provider_user_id: null,
          processing_attempts: null,
          lease_expires_at: null
        }
      ],
      error: null
    });
    const repository = new IntegrationEventProcessingRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(repository.claim(eventId, leaseId)).resolves.toEqual({
      outcome,
      event: null
    });
  });

  it.each([
    ['applied', 'APPLY'],
    ['stale_noop', 'STALE_NOOP'],
    ['equivalent_noop', 'EQUIVALENT_NOOP'],
    ['freshness_conflict', 'FRESHNESS_CONFLICT']
  ] as const)('maps freshness outcome %s', async (raw, outcome) => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ outcome: raw, listing_id: '10000000-0000-4000-8000-000000000005' }],
      error: null
    });
    const repository = new IntegrationEventProcessingRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(
      repository.completeListing({
        eventId,
        leaseId,
        scope,
        listing: summary,
        syncedAt: '2026-08-28T12:00:00.000Z'
      })
    ).resolves.toBe(outcome);
    expect(rpc).toHaveBeenCalledWith(
      'complete_integration_event_listing',
      expect.objectContaining({
        p_event_id: eventId,
        p_lease_id: leaseId,
        p_listing: expect.objectContaining({ provider_updated_at: summary.providerUpdatedAt })
      })
    );
  });

  it('rejects a missing provider timestamp before completion RPC', async () => {
    const rpc = vi.fn();
    const repository = new IntegrationEventProcessingRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(
      repository.completeListing({
        eventId,
        leaseId,
        scope,
        listing: { ...summary, providerUpdatedAt: null },
        syncedAt: '2026-08-28T12:00:00.000Z'
      })
    ).rejects.toThrow('timestamp missing');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('persists only controlled failure metadata', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'retry_scheduled', error: null });
    const repository = new IntegrationEventProcessingRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(
      repository.fail({
        eventId,
        leaseId,
        errorCode: 'provider_timeout',
        errorSummary: 'Provider request timed out',
        retryable: true,
        retryAfterAt: '2026-08-28T12:01:00.000Z'
      })
    ).resolves.toBe('RETRY_SCHEDULED');
    expect(rpc).toHaveBeenCalledWith('fail_integration_event_processing', {
      p_event_id: eventId,
      p_lease_id: leaseId,
      p_error_code: 'provider_timeout',
      p_error_summary: 'Provider request timed out',
      p_retryable: true,
      p_retry_after_at: '2026-08-28T12:01:00.000Z'
    });
  });

  it('lists only validated due retry IDs with an explicit limit', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ event_id: eventId }],
      error: null
    });
    const repository = new IntegrationEventProcessingRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(repository.listDueRetries(25)).resolves.toEqual([eventId]);
    expect(rpc).toHaveBeenCalledWith('list_due_integration_event_retries', { p_limit: 25 });
    await expect(repository.listDueRetries(101)).rejects.toThrow();
  });

  it.each([
    ['listReceivedForConnection', 'list_received_integration_events_for_connection'],
    ['listDueRetriesForConnection', 'list_due_integration_event_retries_for_connection']
  ] as const)('selects bounded Connection work through %s', async (method, rpcName) => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ event_id: eventId }], error: null });
    const repository = new IntegrationEventProcessingRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(repository[method](scope.connectionId, 10)).resolves.toEqual([eventId]);
    expect(rpc).toHaveBeenCalledWith(rpcName, {
      p_connection_id: scope.connectionId,
      p_limit: 10
    });
  });

  it('sanitizes RPC failures', async () => {
    const repository = new IntegrationEventProcessingRepository({
      rpc: vi.fn().mockRejectedValue(new Error('raw SQL secret'))
    } as unknown as SupabaseClient);
    const error = await repository.claim(eventId, leaseId).catch((cause) => cause);

    expect(error).toMatchObject({ name: 'PersistenceError' });
    expect(JSON.stringify(error)).not.toContain('raw SQL secret');
  });
});
