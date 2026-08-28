import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ListingRepository, PersistenceError } from './repositories';
import { ListingSyncService } from './listing-sync-service';

const scope = {
  organizationId: 'org_a',
  storeId: '11111111-1111-4111-8111-111111111111',
  connectionId: '22222222-2222-4222-8222-222222222222'
};
const runId = '33333333-3333-4333-8333-333333333333';

const summary = {
  externalId: 'external_listing_1',
  title: 'Listing A',
  status: 'active',
  price: 123.45,
  currency: 'ARS',
  availableQuantity: 3,
  soldQuantity: 1,
  listingType: null,
  permalink: null,
  thumbnail: null,
  catalogProductId: null,
  sellerSku: null,
  condition: 'used',
  providerCreatedAt: '2026-08-23T00:00:00.000Z',
  providerUpdatedAt: '2026-08-24T00:00:00.000Z'
};

describe('ListingRepository', () => {
  it('upserts normalized listings only after proving the full trusted scope', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: scope.connectionId }, error: null });
    const storeFilter = vi.fn(() => ({ maybeSingle }));
    const organizationFilter = vi.fn(() => ({ eq: storeFilter }));
    const connectionFilter = vi.fn(() => ({ eq: organizationFilter }));
    const selectConnection = vi.fn(() => ({ eq: connectionFilter }));
    const selectListings = vi.fn().mockResolvedValue({ data: [], error: null });
    const upsert = vi.fn(() => ({ select: selectListings }));
    const from = vi
      .fn()
      .mockReturnValueOnce({ select: selectConnection })
      .mockReturnValueOnce({ upsert });
    const repository = new ListingRepository({ from } as never);

    await expect(
      repository.upsertMany(scope, [summary], '2026-08-24T00:00:00.000Z')
    ).resolves.toEqual([]);
    expect(connectionFilter).toHaveBeenCalledWith('id', scope.connectionId);
    expect(organizationFilter).toHaveBeenCalledWith('organization_id', scope.organizationId);
    expect(storeFilter).toHaveBeenCalledWith('store_id', scope.storeId);
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          organization_id: scope.organizationId,
          store_id: scope.storeId,
          connection_id: scope.connectionId,
          external_listing_id: summary.externalId,
          seller_sku: null,
          price: '123.45',
          provider_created_at: summary.providerCreatedAt,
          provider_updated_at: summary.providerUpdatedAt
        })
      ],
      { onConflict: 'connection_id,external_listing_id' }
    );
  });

  it('fails closed when the connection does not belong to the supplied Store and Organization', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const repository = new ListingRepository({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) }))
        }))
      }))
    } as never);

    await expect(
      repository.upsertMany(scope, [summary], '2026-08-24T00:00:00.000Z')
    ).rejects.toBeInstanceOf(PersistenceError);
  });

  it('persists positive evidence through the scoped run-aware RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repository = new ListingRepository({ rpc } as never);

    await expect(
      repository.upsertManyForRun(scope, runId, [summary], '2026-08-24T00:00:00.000Z')
    ).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith('persist_listing_sync_batch_for_run', {
      p_organization_id: scope.organizationId,
      p_store_id: scope.storeId,
      p_connection_id: scope.connectionId,
      p_run_id: runId,
      p_synced_at: '2026-08-24T00:00:00.000Z',
      p_listings: [expect.objectContaining({ external_listing_id: summary.externalId })]
    });
  });
});

describe('ListingSyncService', () => {
  it('passes canonical summaries to the repository without provider-specific fields', async () => {
    const upsertMany = vi.fn().mockResolvedValue([]);
    const service = new ListingSyncService({ upsertMany } as never);

    await service.syncAuthorizedConnection({
      scope,
      summaries: [summary],
      syncedAt: '2026-08-24T00:00:00.000Z'
    });

    expect(upsertMany).toHaveBeenCalledWith(scope, [summary], '2026-08-24T00:00:00.000Z');
  });

  it('binds positive persistence to the current run when requested by the orchestrator', async () => {
    const upsertManyForRun = vi.fn().mockResolvedValue([]);
    const service = new ListingSyncService({ upsertManyForRun } as never);

    await service.syncAuthorizedRun({
      scope,
      runId,
      summaries: [summary],
      syncedAt: '2026-08-24T00:00:00.000Z'
    });

    expect(upsertManyForRun).toHaveBeenCalledWith(
      scope,
      runId,
      [summary],
      '2026-08-24T00:00:00.000Z'
    );
  });
});
