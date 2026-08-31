import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { MercadoLibreCredentialError } from '../auth';
import { MercadoLibreListingsError } from '../listings';
import { MercadoLibreEventProcessor } from './processor';

const eventId = '10000000-0000-4000-8000-000000000001';
const leaseId = '10000000-0000-4000-8000-000000000002';
const event = {
  id: eventId,
  organizationId: 'org_test',
  storeId: '10000000-0000-4000-8000-000000000003',
  connectionId: '10000000-0000-4000-8000-000000000004',
  provider: 'mercado-libre' as const,
  topic: 'items',
  resource: '/items/MLA123456',
  externalResourceId: 'MLA123456',
  providerUserId: '123',
  processingAttempts: 1,
  leaseExpiresAt: '2026-08-28T12:05:00.000Z'
};
const connection = {
  id: event.connectionId,
  organizationId: event.organizationId,
  storeId: event.storeId,
  provider: 'mercado-libre' as const,
  externalAccountId: event.providerUserId,
  status: 'active' as const,
  scopes: [],
  expiresAt: null
};
const listing = {
  externalId: event.externalResourceId,
  title: 'Listing',
  status: 'active',
  price: 10,
  currency: 'ARS',
  availableQuantity: 2,
  soldQuantity: 1,
  listingType: 'gold',
  permalink: null,
  thumbnail: null,
  catalogProductId: null,
  sellerSku: null,
  condition: 'new',
  providerCreatedAt: '2026-08-28T10:00:00.000Z',
  providerUpdatedAt: '2026-08-28T11:00:00.000Z'
};

function setup() {
  const events = {
    claim: vi.fn().mockResolvedValue({ outcome: 'CLAIMED', event }),
    completeListing: vi.fn().mockResolvedValue('APPLY'),
    fail: vi
      .fn()
      .mockImplementation((input: { retryable: boolean }) =>
        Promise.resolve(input.retryable ? 'RETRY_SCHEDULED' : 'FAILED')
      )
  };
  const connections = { getById: vi.fn().mockResolvedValue(connection) };
  const credentials = { getValidAccessToken: vi.fn().mockResolvedValue('test-token') };
  const listings = {
    getListingDetails: vi.fn().mockResolvedValue({ items: [listing], failures: [] })
  };
  return {
    processor: new MercadoLibreEventProcessor({
      events: events as never,
      connections,
      credentials,
      listings,
      newLeaseId: () => leaseId,
      now: () => new Date('2026-08-28T12:00:00.000Z')
    }),
    events,
    connections,
    credentials,
    listings
  };
}

describe('MercadoLibreEventProcessor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['APPLY', 'STALE_NOOP', 'EQUIVALENT_NOOP'] as const)(
    'finalizes successful freshness outcome %s',
    async (outcome) => {
      const test = setup();
      test.events.completeListing.mockResolvedValue(outcome);

      await expect(test.processor.process(eventId)).resolves.toEqual({
        outcome,
        processingAttempts: 1,
        safeErrorCode: null
      });
      expect(test.listings.getListingDetails).toHaveBeenCalledWith({
        accessToken: 'test-token',
        itemIds: ['MLA123456']
      });
      expect(test.events.fail).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['ALREADY_PROCESSED', 'ALREADY_PROCESSED'],
    ['ALREADY_PROCESSING', 'CLAIM_DENIED'],
    ['NOT_FOUND', 'CLAIM_DENIED'],
    ['NOT_RETRYABLE', 'FAILED_PERMANENT']
  ] as const)('does no work after claim outcome %s', async (claim, outcome) => {
    const test = setup();
    test.events.claim.mockResolvedValue({ outcome: claim, event: null });

    await expect(test.processor.process(eventId)).resolves.toMatchObject({ outcome });
    expect(test.connections.getById).not.toHaveBeenCalled();
    expect(test.listings.getListingDetails).not.toHaveBeenCalled();
  });

  it('does no work when a retry is not due yet', async () => {
    const test = setup();
    test.events.claim.mockResolvedValue({ outcome: 'NOT_YET_DUE', event: null });

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: 'CLAIM_DENIED'
    });
    expect(test.connections.getById).not.toHaveBeenCalled();
  });

  it('fails a non-canonical persisted resource permanently', async () => {
    const test = setup();
    test.events.claim.mockResolvedValue({
      outcome: 'CLAIMED',
      event: { ...event, resource: 'https://evil.example/items/MLA123456' }
    });

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: 'FAILED_PERMANENT',
      safeErrorCode: 'invalid_provider_response'
    });
    expect(test.listings.getListingDetails).not.toHaveBeenCalled();
  });

  it('revalidates the persisted Connection before credentials or provider', async () => {
    const test = setup();
    test.connections.getById.mockResolvedValue({ ...connection, storeId: leaseId });

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: 'FAILED_PERMANENT',
      safeErrorCode: 'connection_binding_invalid'
    });
    expect(test.credentials.getValidAccessToken).not.toHaveBeenCalled();
  });

  it('fails closed on missing provider_updated_at', async () => {
    const test = setup();
    test.listings.getListingDetails.mockResolvedValue({
      items: [{ ...listing, providerUpdatedAt: null }],
      failures: []
    });

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: 'FAILED_PERMANENT',
      safeErrorCode: 'ambiguous_provider_timestamp'
    });
    expect(test.events.completeListing).not.toHaveBeenCalled();
  });

  it('fails an equal timestamp conflict without marking processed', async () => {
    const test = setup();
    test.events.completeListing.mockResolvedValue('FRESHNESS_CONFLICT');

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: 'FAILED_PERMANENT',
      safeErrorCode: 'ambiguous_provider_timestamp'
    });
    expect(test.events.fail).toHaveBeenCalledWith(expect.objectContaining({ retryable: false }));
  });

  it.each([
    [
      '404',
      {
        externalListingId: 'MLA123456',
        kind: 'provider_client_error',
        retryable: false,
        status: 404
      },
      'resource_not_found',
      false
    ],
    [
      '429',
      {
        externalListingId: 'MLA123456',
        kind: 'provider_rate_limited',
        retryable: true,
        status: 429
      },
      'provider_rate_limited',
      true
    ],
    [
      '5xx',
      {
        externalListingId: 'MLA123456',
        kind: 'provider_server_error',
        retryable: true,
        status: 503
      },
      'provider_unavailable',
      true
    ],
    [
      'timeout',
      { externalListingId: 'MLA123456', kind: 'provider_timeout', retryable: true, status: null },
      'provider_timeout',
      true
    ]
  ] as const)('classifies provider %s safely', async (_label, failure, code, retryable) => {
    const test = setup();
    test.listings.getListingDetails.mockResolvedValue({ items: [], failures: [failure] });

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: retryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT',
      safeErrorCode: code
    });
    expect(test.events.completeListing).not.toHaveBeenCalled();
    expect(test.events.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: code, retryable })
    );
  });

  it('classifies a thrown provider timeout without leaking it', async () => {
    const test = setup();
    test.listings.getListingDetails.mockRejectedValue(
      new MercadoLibreListingsError('provider_timeout', 'details', true)
    );

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: 'FAILED_RETRYABLE',
      safeErrorCode: 'provider_timeout'
    });
  });

  it('forwards a parsed Retry-After lower bound as safe scheduling metadata', async () => {
    const test = setup();
    test.listings.getListingDetails.mockRejectedValue(
      new MercadoLibreListingsError('provider_rate_limited', 'details', true, 429, 120_000)
    );

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: 'FAILED_RETRYABLE',
      safeErrorCode: 'provider_rate_limited'
    });
    expect(test.events.fail).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterAt: '2026-08-28T12:02:00.000Z' })
    );
  });

  it('reports max-attempt exhaustion as permanent', async () => {
    const test = setup();
    test.events.fail.mockResolvedValue('RETRY_EXHAUSTED');
    test.listings.getListingDetails.mockRejectedValue(
      new MercadoLibreListingsError('provider_timeout', 'details', true)
    );

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: 'FAILED_PERMANENT',
      safeErrorCode: 'retry_exhausted'
    });
  });

  it('classifies a transient credential refresh failure', async () => {
    const test = setup();
    test.credentials.getValidAccessToken.mockRejectedValue(
      new MercadoLibreCredentialError('REFRESH_BUSY', 'CLAIM')
    );

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: 'FAILED_RETRYABLE',
      safeErrorCode: 'provider_unavailable'
    });
    expect(test.listings.getListingDetails).not.toHaveBeenCalled();
  });

  it('records a transient DB completion failure without processing the event', async () => {
    const test = setup();
    test.events.completeListing.mockRejectedValue(new Error('raw DB detail'));

    await expect(test.processor.process(eventId)).resolves.toMatchObject({
      outcome: 'FAILED_RETRYABLE',
      safeErrorCode: 'persistence_failure'
    });
    expect(test.events.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        errorSummary: 'Persistence operation failed',
        retryable: true
      })
    );
  });
});
