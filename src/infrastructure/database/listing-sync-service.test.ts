import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ListingRepository, PersistenceError } from './repositories';
import { ListingSyncService } from './listing-sync-service';

const scope = {
  organizationId: 'org_a',
  storeId: '11111111-1111-4111-8111-111111111111',
  connectionId: '22222222-2222-4222-8222-222222222222'
};

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
  condition: 'used'
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
          price: '123.45'
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
});
