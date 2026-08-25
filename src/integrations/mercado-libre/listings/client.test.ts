import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { ExternalListingSummary } from '@/integrations/core';
import {
  MercadoLibreListingsClient,
  MercadoLibreListingsError,
  type MercadoLibreListingDiscoveryPage
} from './client';
import { MercadoLibreListingsService } from './service';

const organizationId = 'org_test';
const storeId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';

function item(id: string, status = 'active') {
  return {
    id,
    title: `Listing ${id}`,
    status,
    price: 123,
    currency_id: 'ARS',
    available_quantity: 4,
    sold_quantity: 2,
    date_created: '2026-08-23T00:00:00.000Z',
    last_updated: '2026-08-24T00:00:00.000Z',
    attributes: [{ id: 'SELLER_SKU', value_name: `SKU-${id}` }]
  };
}

function summary(id: string, status = 'active'): ExternalListingSummary {
  return {
    externalId: id,
    title: `Listing ${id}`,
    status,
    price: 123,
    currency: 'ARS',
    availableQuantity: 4,
    soldQuantity: 2,
    listingType: null,
    permalink: null,
    thumbnail: null,
    catalogProductId: null,
    sellerSku: `SKU-${id}`,
    condition: null,
    providerCreatedAt: '2026-08-23T00:00:00.000Z',
    providerUpdatedAt: '2026-08-24T00:00:00.000Z'
  };
}

function activeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: connectionId,
    organizationId,
    storeId,
    provider: 'mercado-libre',
    status: 'active',
    externalAccountId: '123',
    scopes: [],
    expiresAt: null,
    ...overrides
  };
}

describe('MercadoLibreListingsClient', () => {
  it('uses bounded multiget and maps provider timestamps plus active, paused, and closed', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: ['MLA1', 'MLA2', 'MLA3'],
            paging: { total: 3 }
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { code: 200, body: item('MLA1', 'active') },
            { code: 200, body: item('MLA2', 'paused') },
            { code: 200, body: item('MLA3', 'closed') }
          ])
        )
      );
    const client = new MercadoLibreListingsClient(
      { apiBaseUrl: 'https://api.example.test' },
      fetcher
    );

    await expect(
      client.listSellerListings({
        accessToken: 'test-access-token',
        sellerId: '123',
        limit: 99
      })
    ).resolves.toMatchObject({
      total: 3,
      nextCursor: null,
      failures: [],
      items: [
        {
          externalId: 'MLA1',
          status: 'active',
          providerCreatedAt: '2026-08-23T00:00:00.000Z',
          providerUpdatedAt: '2026-08-24T00:00:00.000Z'
        },
        { externalId: 'MLA2', status: 'paused' },
        { externalId: 'MLA3', status: 'closed' }
      ]
    });

    const [searchUrl] = fetcher.mock.calls[0] as [URL];
    const [itemsUrl] = fetcher.mock.calls[1] as [URL];
    expect(searchUrl.searchParams.get('limit')).toBe('20');
    expect(searchUrl.searchParams.get('offset')).toBe('0');
    expect(itemsUrl.searchParams.get('ids')).toBe('MLA1,MLA2,MLA3');
    expect(itemsUrl.searchParams.get('attributes')).toContain('date_created,last_updated');
  });

  it('pages with offset and transitions to scan until the scroll ends', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: ['OLD'], paging: { total: 1001 } }))
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: ['MLA1'],
            paging: { total: 1001 },
            scroll_id: 'scroll-a'
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [],
            paging: { total: 1001 },
            scroll_id: null
          })
        )
      );
    const client = new MercadoLibreListingsClient(
      { apiBaseUrl: 'https://api.example.test' },
      fetcher
    );

    const first = await client.discoverSellerListingIds({
      accessToken: 'token',
      sellerId: '123'
    });
    expect(first).toEqual({
      itemIds: ['MLA1'],
      total: 1001,
      nextCursor: { mode: 'scan', scrollId: 'scroll-a' }
    });
    await expect(
      client.discoverSellerListingIds({
        accessToken: 'token',
        sellerId: '123',
        cursor: first.nextCursor
      })
    ).resolves.toEqual({ itemIds: [], total: 1001, nextCursor: null });

    const [offsetUrl] = fetcher.mock.calls[0] as [URL];
    const [scanUrl] = fetcher.mock.calls[1] as [URL];
    const [scrollUrl] = fetcher.mock.calls[2] as [URL];
    expect(offsetUrl.searchParams.get('offset')).toBe('0');
    expect(scanUrl.searchParams.get('search_type')).toBe('scan');
    expect(scanUrl.searchParams.has('scroll_id')).toBe(false);
    expect(scrollUrl.searchParams.get('scroll_id')).toBe('scroll-a');
  });

  it('advances normal offset pagination and stops on the final page', async () => {
    const firstIds = Array.from({ length: 100 }, (_, index) => `MLA${index + 1}`);
    const lastIds = Array.from({ length: 25 }, (_, index) => `MLA${index + 101}`);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: firstIds, paging: { total: 125 } }))
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: lastIds, paging: { total: 125 } }))
      );
    const client = new MercadoLibreListingsClient(
      { apiBaseUrl: 'https://api.example.test' },
      fetcher
    );

    const first = await client.discoverSellerListingIds({
      accessToken: 'token',
      sellerId: '123'
    });
    expect(first.nextCursor).toEqual({ mode: 'offset', offset: 100 });
    const last = await client.discoverSellerListingIds({
      accessToken: 'token',
      sellerId: '123',
      cursor: first.nextCursor
    });
    expect(last).toMatchObject({ itemIds: lastIds, nextCursor: null });
    const [lastUrl] = fetcher.mock.calls[1] as [URL];
    expect(lastUrl.searchParams.get('offset')).toBe('100');
  });

  it('returns sanitized partial failures while preserving valid items', async () => {
    const client = new MercadoLibreListingsClient(
      { apiBaseUrl: 'https://api.example.test' },
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            { code: 200, body: item('MLA1') },
            { code: 404, body: { message: 'sensitive body is ignored' } },
            { code: 200, body: { id: 'MLA3' } }
          ])
        )
      )
    );

    await expect(
      client.getListingDetails({
        accessToken: 'secret-token',
        itemIds: ['MLA1', 'MLA2', 'MLA3']
      })
    ).resolves.toEqual({
      items: [expect.objectContaining({ externalId: 'MLA1' })],
      failures: [
        {
          externalListingId: 'MLA2',
          kind: 'provider_client_error',
          retryable: false,
          status: 404
        },
        {
          externalListingId: 'MLA3',
          kind: 'invalid_provider_response',
          retryable: false,
          status: 200
        }
      ]
    });
  });

  it('retries 429 and respects a valid Retry-After value', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [], paging: { total: 0 } })));
    const client = new MercadoLibreListingsClient(
      {
        apiBaseUrl: 'https://api.example.test',
        baseDelayMs: 100,
        sleep,
        random: () => 0
      },
      fetcher
    );

    await expect(
      client.discoverSellerListingIds({
        accessToken: 'token',
        sellerId: '123'
      })
    ).resolves.toMatchObject({ itemIds: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries 5xx with deterministic exponential backoff and jitter', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [], paging: { total: 0 } })));
    const client = new MercadoLibreListingsClient(
      {
        apiBaseUrl: 'https://api.example.test',
        baseDelayMs: 100,
        sleep,
        random: () => 0.5
      },
      fetcher
    );

    await client.discoverSellerListingIds({
      accessToken: 'token',
      sellerId: '123'
    });
    expect(sleep).toHaveBeenCalledWith(150);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable 4xx or expose the bearer token', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    const client = new MercadoLibreListingsClient(
      { apiBaseUrl: 'https://api.example.test' },
      fetcher
    );
    const token = 'token-not-for-output';

    const error = await client
      .discoverSellerListingIds({ accessToken: token, sellerId: '123' })
      .catch((value: unknown) => value);
    expect(error).toEqual(
      expect.objectContaining({
        kind: 'provider_client_error',
        retryable: false,
        status: 403
      })
    );
    expect(String(error)).not.toContain(token);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('aborts timed out requests and stops at max attempts', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn((_url: URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    const client = new MercadoLibreListingsClient(
      {
        apiBaseUrl: 'https://api.example.test',
        timeoutMs: 1,
        maxAttempts: 2,
        baseDelayMs: 0,
        sleep,
        random: () => 0
      },
      fetcher as typeof fetch
    );

    await expect(
      client.discoverSellerListingIds({
        accessToken: 'token',
        sellerId: '123'
      })
    ).rejects.toEqual(expect.objectContaining({ kind: 'provider_timeout', retryable: true }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('exhausts bounded network retries and rejects malformed responses without retry', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const networkFetcher = vi.fn().mockRejectedValue(new Error('offline with token-secret'));
    const networkClient = new MercadoLibreListingsClient(
      {
        apiBaseUrl: 'https://api.example.test',
        maxAttempts: 3,
        baseDelayMs: 0,
        sleep,
        random: () => 0
      },
      networkFetcher
    );
    await expect(
      networkClient.discoverSellerListingIds({
        accessToken: 'token-secret',
        sellerId: '123'
      })
    ).rejects.toEqual(expect.objectContaining({ kind: 'provider_network_error' }));
    expect(networkFetcher).toHaveBeenCalledTimes(3);

    const malformedFetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ results: [1] })));
    const malformedClient = new MercadoLibreListingsClient(
      { apiBaseUrl: 'https://api.example.test' },
      malformedFetcher
    );
    await expect(
      malformedClient.discoverSellerListingIds({
        accessToken: 'token',
        sellerId: '123'
      })
    ).rejects.toBeInstanceOf(MercadoLibreListingsError);
    expect(malformedFetcher).toHaveBeenCalledOnce();
  });
});

describe('MercadoLibreListingsService', () => {
  it('requires an active, tenant-bound connection before reading credentials', async () => {
    const getById = vi.fn().mockResolvedValue(activeConnection());
    const getValidAccessToken = vi.fn().mockResolvedValue('test-access-token');
    const listSellerListings = vi.fn().mockResolvedValue({
      items: [],
      failures: [],
      total: 0,
      nextCursor: null
    });
    const service = new MercadoLibreListingsService(
      { getById } as never,
      { getValidAccessToken } as never,
      { listSellerListings } as never
    );

    await expect(
      service.listActiveConnectionListings({
        organizationId,
        storeId,
        connectionId
      })
    ).resolves.toMatchObject({ items: [], total: 0 });
    expect(getValidAccessToken).toHaveBeenCalledWith({
      organizationId,
      connectionId
    });
    expect(listSellerListings).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: '123', limit: 20 })
    );
  });

  it('completes multiple pages with 20-item chunks and a final partial chunk', async () => {
    const firstIds = Array.from({ length: 25 }, (_, index) => `MLA${index + 1}`);
    const secondIds = Array.from({ length: 20 }, (_, index) => `MLA${index + 26}`);
    const pages: MercadoLibreListingDiscoveryPage[] = [
      {
        itemIds: firstIds,
        total: 45,
        nextCursor: { mode: 'offset', offset: 25 }
      },
      { itemIds: secondIds, total: 45, nextCursor: null }
    ];
    const discoverSellerListingIds = vi
      .fn()
      .mockResolvedValueOnce(pages[0])
      .mockResolvedValueOnce(pages[1]);
    const getListingDetails = vi.fn(({ itemIds }: { itemIds: string[] }) =>
      Promise.resolve({
        items: itemIds.map((id, index) => summary(id, ['active', 'paused', 'closed'][index % 3])),
        failures: []
      })
    );
    const syncAuthorizedConnection = vi.fn(
      ({ summaries }: { summaries: ExternalListingSummary[] }) =>
        Promise.resolve(summaries.map((value) => ({ id: value.externalId })))
    );
    const service = new MercadoLibreListingsService(
      { getById: vi.fn().mockResolvedValue(activeConnection()) } as never,
      { getValidAccessToken: vi.fn().mockResolvedValue('token') } as never,
      { discoverSellerListingIds, getListingDetails } as never,
      { syncAuthorizedConnection } as never
    );

    await expect(
      service.syncAllActiveConnectionListings({
        organizationId,
        storeId,
        connectionId
      })
    ).resolves.toEqual({
      discovered: 45,
      requested: 45,
      fetched: 45,
      persisted: 45,
      failed: 0,
      failures: []
    });
    expect(getListingDetails.mock.calls.map(([input]) => input.itemIds.length)).toEqual([
      20, 5, 20
    ]);
    expect(syncAuthorizedConnection).toHaveBeenCalledTimes(3);
    expect(discoverSellerListingIds).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { mode: 'offset', offset: 25 } })
    );
    expect(syncAuthorizedConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        summaries: expect.arrayContaining([
          expect.objectContaining({ status: 'active' }),
          expect.objectContaining({ status: 'paused' }),
          expect.objectContaining({ status: 'closed' })
        ])
      })
    );
  });

  it('persists valid items and reports partial item failures', async () => {
    const failure = {
      externalListingId: 'MLA2',
      kind: 'provider_client_error' as const,
      retryable: false,
      status: 404
    };
    const syncAuthorizedConnection = vi.fn().mockResolvedValue([{ id: 'row-1' }]);
    const service = new MercadoLibreListingsService(
      { getById: vi.fn().mockResolvedValue(activeConnection()) } as never,
      { getValidAccessToken: vi.fn().mockResolvedValue('token') } as never,
      {
        discoverSellerListingIds: vi.fn().mockResolvedValue({
          itemIds: ['MLA1', 'MLA2'],
          total: 2,
          nextCursor: null
        }),
        getListingDetails: vi.fn().mockResolvedValue({
          items: [summary('MLA1')],
          failures: [failure]
        })
      } as never,
      { syncAuthorizedConnection } as never
    );

    await expect(
      service.syncAllActiveConnectionListings({
        organizationId,
        storeId,
        connectionId
      })
    ).resolves.toEqual({
      discovered: 2,
      requested: 2,
      fetched: 1,
      persisted: 1,
      failed: 1,
      failures: [failure]
    });
    expect(syncAuthorizedConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        summaries: [expect.objectContaining({ externalId: 'MLA1' })]
      })
    );
  });

  it('continues after an exhausted detail chunk and persists later chunks', async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `MLA${index + 1}`);
    const getListingDetails = vi
      .fn()
      .mockRejectedValueOnce(
        new MercadoLibreListingsError('provider_server_error', 'details', true, 503)
      )
      .mockResolvedValueOnce({ items: [summary('MLA21')], failures: [] });
    const syncAuthorizedConnection = vi.fn().mockResolvedValue([{ id: 'row-21' }]);
    const service = new MercadoLibreListingsService(
      { getById: vi.fn().mockResolvedValue(activeConnection()) } as never,
      { getValidAccessToken: vi.fn().mockResolvedValue('token') } as never,
      {
        discoverSellerListingIds: vi.fn().mockResolvedValue({
          itemIds: ids,
          total: 21,
          nextCursor: null
        }),
        getListingDetails
      } as never,
      { syncAuthorizedConnection } as never
    );

    const result = await service.syncAllActiveConnectionListings({
      organizationId,
      storeId,
      connectionId
    });
    expect(result).toMatchObject({
      discovered: 21,
      requested: 21,
      fetched: 1,
      persisted: 1,
      failed: 20
    });
    expect(result.failures[0]).toEqual({
      externalListingId: 'MLA1',
      kind: 'provider_server_error',
      retryable: true,
      status: 503
    });
    expect(syncAuthorizedConnection).toHaveBeenCalledOnce();
  });

  it('deduplicates IDs across pages and remains idempotent across repeated backfills', async () => {
    const persistedRows = new Map<string, { id: string }>();
    const syncAuthorizedConnection = vi.fn(
      ({ summaries }: { summaries: ExternalListingSummary[] }) =>
        Promise.resolve(
          summaries.map((value) => {
            const current = persistedRows.get(value.externalId) ?? {
              id: `row-${value.externalId}`
            };
            persistedRows.set(value.externalId, current);
            return current;
          })
        )
    );
    const makeListings = () => {
      const discoverSellerListingIds = vi
        .fn()
        .mockResolvedValueOnce({
          itemIds: ['MLA1', 'MLA2'],
          total: 3,
          nextCursor: { mode: 'offset', offset: 2 }
        })
        .mockResolvedValueOnce({
          itemIds: ['MLA2', 'MLA3'],
          total: 3,
          nextCursor: null
        });
      return {
        discoverSellerListingIds,
        getListingDetails: vi.fn(({ itemIds }: { itemIds: string[] }) =>
          Promise.resolve({
            items: itemIds.map((id) => summary(id)),
            failures: []
          })
        )
      };
    };
    const run = async () => {
      const service = new MercadoLibreListingsService(
        { getById: vi.fn().mockResolvedValue(activeConnection()) } as never,
        { getValidAccessToken: vi.fn().mockResolvedValue('token') } as never,
        makeListings() as never,
        { syncAuthorizedConnection } as never
      );
      return service.syncAllActiveConnectionListings({
        organizationId,
        storeId,
        connectionId
      });
    };

    await expect(run()).resolves.toMatchObject({ discovered: 3, persisted: 3 });
    await expect(run()).resolves.toMatchObject({ discovered: 3, persisted: 3 });
    expect(persistedRows.size).toBe(3);
  });

  it('denies cross-store scope before credentials, discovery, or persistence', async () => {
    const getValidAccessToken = vi.fn();
    const discoverSellerListingIds = vi.fn();
    const syncAuthorizedConnection = vi.fn();
    const service = new MercadoLibreListingsService(
      {
        getById: vi.fn().mockResolvedValue(
          activeConnection({
            storeId: '33333333-3333-4333-8333-333333333333'
          })
        )
      } as never,
      { getValidAccessToken } as never,
      { discoverSellerListingIds } as never,
      { syncAuthorizedConnection } as never
    );

    await expect(
      service.syncAllActiveConnectionListings({
        organizationId,
        storeId,
        connectionId
      })
    ).rejects.toEqual(expect.objectContaining({ kind: 'connection_binding_invalid' }));
    expect(getValidAccessToken).not.toHaveBeenCalled();
    expect(discoverSellerListingIds).not.toHaveBeenCalled();
    expect(syncAuthorizedConnection).not.toHaveBeenCalled();
  });

  it('stops before discovery when credential rotation cannot provide a token', async () => {
    const discoverSellerListingIds = vi.fn();
    const service = new MercadoLibreListingsService(
      { getById: vi.fn().mockResolvedValue(activeConnection()) } as never,
      {
        getValidAccessToken: vi.fn().mockRejectedValue(new Error('token_refresh_failed'))
      } as never,
      { discoverSellerListingIds } as never
    );

    await expect(
      service.syncAllActiveConnectionListings({
        organizationId,
        storeId,
        connectionId
      })
    ).rejects.toEqual(expect.objectContaining({ message: 'token_refresh_failed' }));
    expect(discoverSellerListingIds).not.toHaveBeenCalled();
  });
});
