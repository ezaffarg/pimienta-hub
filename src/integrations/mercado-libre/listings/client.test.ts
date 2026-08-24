import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { MercadoLibreListingsClient, MercadoLibreListingsError } from './client';
import { MercadoLibreListingsService, MercadoLibreListingsServiceError } from './service';

describe('MercadoLibreListingsClient', () => {
  it('uses seller search pagination and a bounded multiget detail request', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: ['MLA1', 'MLA2'], paging: { total: 3 } }))
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              code: 200,
              body: {
                id: 'MLA1',
                title: 'First',
                status: 'active',
                price: 123,
                currency_id: 'ARS',
                available_quantity: 4,
                sold_quantity: 2,
                attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-1' }]
              }
            },
            { code: 200, body: { id: 'MLA2', title: 'Second', status: 'paused' } }
          ])
        )
      );
    const client = new MercadoLibreListingsClient(
      { apiBaseUrl: 'https://api.example.test' },
      fetcher
    );

    await expect(
      client.listSellerListings({ accessToken: 'test-access-token', sellerId: '123', limit: 99 })
    ).resolves.toMatchObject({
      total: 3,
      nextCursor: '2',
      items: [
        { externalId: 'MLA1', sellerSku: 'SKU-1' },
        { externalId: 'MLA2', price: null, sellerSku: null }
      ]
    });

    const [searchUrl] = fetcher.mock.calls[0] as [URL];
    const [itemsUrl] = fetcher.mock.calls[1] as [URL];
    expect(searchUrl.pathname).toBe('/users/123/items/search');
    expect(searchUrl.searchParams.get('limit')).toBe('20');
    expect(searchUrl.searchParams.get('offset')).toBe('0');
    expect(itemsUrl.pathname).toBe('/items');
    expect(itemsUrl.searchParams.get('ids')).toBe('MLA1,MLA2');
  });

  it('rejects malformed search and detail responses without returning provider payloads', async () => {
    const malformedSearch = new MercadoLibreListingsClient(
      { apiBaseUrl: 'https://api.example.test' },
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [1] })))
    );
    await expect(
      malformedSearch.listSellerListings({ accessToken: 'test-access-token', sellerId: '123' })
    ).rejects.toEqual(expect.objectContaining({ kind: 'invalid_provider_response' }));

    const malformedDetail = new MercadoLibreListingsClient(
      { apiBaseUrl: 'https://api.example.test' },
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ results: ['MLA1'] })))
        .mockResolvedValueOnce(new Response(JSON.stringify([{ code: 200, body: { id: 'MLA1' } }])))
    );
    await expect(
      malformedDetail.listSellerListings({ accessToken: 'test-access-token', sellerId: '123' })
    ).rejects.toBeInstanceOf(MercadoLibreListingsError);
  });

  it('does not expose the bearer token when the provider rejects a request', async () => {
    const client = new MercadoLibreListingsClient(
      { apiBaseUrl: 'https://api.example.test' },
      vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    );
    const token = 'test-access-token-not-for-output';

    await expect(
      client.listSellerListings({ accessToken: token, sellerId: '123' })
    ).rejects.toEqual(
      expect.objectContaining({ kind: 'listing_search_failed', message: 'listing_search_failed' })
    );
  });
});

describe('MercadoLibreListingsService', () => {
  const organizationId = 'org_test';
  const storeId = '11111111-1111-4111-8111-111111111111';
  const connectionId = '22222222-2222-4222-8222-222222222222';

  it('requires an active, tenant-bound Mercado Libre connection before decrypting credentials', async () => {
    const getById = vi.fn().mockResolvedValue({
      id: connectionId,
      organizationId,
      storeId,
      provider: 'mercado-libre',
      status: 'active',
      externalAccountId: '123',
      scopes: [],
      expiresAt: null
    });
    const readDecryptedCredentials = vi.fn().mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      tokenMetadata: {}
    });
    const listSellerListings = vi.fn().mockResolvedValue({ items: [], total: 0, nextCursor: null });
    const service = new MercadoLibreListingsService(
      { getById } as never,
      { readDecryptedCredentials } as never,
      { listSellerListings } as never
    );

    await expect(
      service.listActiveConnectionListings({ organizationId, storeId, connectionId })
    ).resolves.toEqual({ items: [], total: 0, nextCursor: null });
    expect(readDecryptedCredentials).toHaveBeenCalledWith(organizationId, connectionId);
    expect(listSellerListings).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: '123', limit: 20 })
    );
  });

  it('denies a cross-store connection before reading credentials', async () => {
    const getById = vi.fn().mockResolvedValue({
      id: connectionId,
      organizationId,
      storeId: '33333333-3333-4333-8333-333333333333',
      provider: 'mercado-libre',
      status: 'active',
      externalAccountId: '123'
    });
    const readDecryptedCredentials = vi.fn();
    const service = new MercadoLibreListingsService(
      { getById } as never,
      { readDecryptedCredentials } as never,
      {} as never
    );

    await expect(
      service.listActiveConnectionListings({ organizationId, storeId, connectionId })
    ).rejects.toEqual(expect.objectContaining({ kind: 'connection_binding_invalid' }));
    expect(readDecryptedCredentials).not.toHaveBeenCalled();
  });

  it('stops before a provider call when the persisted access token is expired', async () => {
    const getById = vi.fn().mockResolvedValue({
      id: connectionId,
      organizationId,
      storeId,
      provider: 'mercado-libre',
      status: 'active',
      externalAccountId: '123'
    });
    const listSellerListings = vi.fn();
    const service = new MercadoLibreListingsService(
      { getById } as never,
      {
        readDecryptedCredentials: vi.fn().mockResolvedValue({
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
          tokenMetadata: {}
        })
      } as never,
      { listSellerListings } as never
    );

    await expect(
      service.listActiveConnectionListings({ organizationId, storeId, connectionId })
    ).rejects.toBeInstanceOf(MercadoLibreListingsServiceError);
    expect(listSellerListings).not.toHaveBeenCalled();
  });
});
