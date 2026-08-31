import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  MercadoLibreMissedFeedsClient,
  MercadoLibreMissedFeedsError,
  MercadoLibreMissedFeedRecoveryService
} from './missed-feeds';

const organizationId = 'org_test';
const connectionId = '10000000-0000-4000-8000-000000000001';
const storeId = '10000000-0000-4000-8000-000000000002';
const connection = {
  id: connectionId,
  organizationId,
  storeId,
  provider: 'mercado-libre' as const,
  externalAccountId: '123',
  status: 'active' as const,
  scopes: [],
  expiresAt: null
};

function message(id = 'feed-1', itemId = 'MLA123456') {
  return {
    externalEventId: id,
    resource: `/items/${itemId}`,
    user_id: '123',
    topic: 'items' as const,
    application_id: '456',
    attempts: 8,
    sent: '2026-08-28T12:00:00.000Z',
    received: '2026-08-28T12:00:01.000Z'
  };
}

function setup(messages = [message()]) {
  const connections = { getById: vi.fn().mockResolvedValue(connection) };
  const credentials = { getValidAccessToken: vi.fn().mockResolvedValue('test-token') };
  const identity = {
    getCurrentUser: vi.fn().mockResolvedValue({
      externalAccountId: '123',
      displayName: 'Seller',
      siteId: 'MLA'
    })
  };
  const feeds = { getItemsPage: vi.fn().mockResolvedValue(messages) };
  const intake = {
    intakeItemsNotification: vi.fn().mockResolvedValue({
      outcome: 'ACCEPTED',
      eventId: '10000000-0000-4000-8000-000000000003'
    })
  };
  return {
    service: new MercadoLibreMissedFeedRecoveryService({
      connections: connections as never,
      credentials,
      identity,
      feeds,
      intake,
      applicationId: () => '456'
    }),
    connections,
    credentials,
    identity,
    feeds,
    intake
  };
}

describe('MercadoLibreMissedFeedsClient', () => {
  it('uses the official items query and returns only canonical message fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [{ ...message(), _id: message().externalEventId, request: { raw: true } }]
        })
      )
    );
    const client = new MercadoLibreMissedFeedsClient(fetcher, 'https://api.example.test');

    await expect(
      client.getItemsPage({
        accessToken: 'test-token',
        applicationId: '456',
        siteId: 'MLA',
        offset: 0
      })
    ).resolves.toEqual([message()]);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      'https://api.example.test/missed_feeds?app_id=456&topic=items&site_id=MLA&offset=0&limit=10'
    );
    expect(init.headers.authorization).toBe('Bearer test-token');
  });

  it.each([
    [429, 'provider_rate_limited'],
    [503, 'provider_unavailable'],
    [400, 'provider_response_invalid']
  ] as const)('normalizes provider HTTP %s', async (status, code) => {
    const client = new MercadoLibreMissedFeedsClient(
      vi.fn().mockResolvedValue(new Response(null, { status }))
    );
    await expect(
      client.getItemsPage({
        accessToken: 'test-token',
        applicationId: '456',
        siteId: 'MLA',
        offset: 0
      })
    ).rejects.toMatchObject({ code });
  });

  it('fails closed on a malformed feed without exposing its body', async () => {
    const client = new MercadoLibreMissedFeedsClient(
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ raw: 'secret' }] })))
    );
    const error = await client
      .getItemsPage({
        accessToken: 'test-token',
        applicationId: '456',
        siteId: 'MLA',
        offset: 0
      })
      .catch((cause) => cause);
    expect(error).toMatchObject({ code: 'provider_response_invalid' });
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('normalizes a timeout', async () => {
    vi.useFakeTimers();
    try {
      const client = new MercadoLibreMissedFeedsClient(
        vi.fn(
          (_url: URL | RequestInfo, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError'))
              );
            })
        ) as typeof fetch,
        'https://api.example.test',
        10
      );
      const request = client.getItemsPage({
        accessToken: 'test-token',
        applicationId: '456',
        siteId: 'MLA',
        offset: 0
      });
      const rejection = expect(request).rejects.toMatchObject({ code: 'provider_timeout' });
      await vi.advanceTimersByTimeAsync(10);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MercadoLibreMissedFeedRecoveryService', () => {
  it.each([
    ['ACCEPTED', 1, 0],
    ['DUPLICATE', 0, 1]
  ] as const)('reuses X-B intake for %s', async (outcome, accepted, duplicates) => {
    const test = setup();
    test.intake.intakeItemsNotification.mockResolvedValue({
      outcome,
      eventId: '10000000-0000-4000-8000-000000000003'
    });

    await expect(test.service.recoverItems({ organizationId, connectionId })).resolves.toEqual({
      pages: 1,
      accepted,
      duplicates,
      exhausted: true,
      nextOffset: null
    });
    const { externalEventId: _id, ...notification } = message();
    expect(test.intake.intakeItemsNotification).toHaveBeenCalledWith({ _id, ...notification });
  });

  it('resolves site_id from authenticated identity and checks Connection identity', async () => {
    const test = setup();
    await test.service.recoverItems({ organizationId, connectionId });

    expect(test.identity.getCurrentUser).toHaveBeenCalledWith('test-token');
    expect(test.feeds.getItemsPage).toHaveBeenCalledWith({
      accessToken: 'test-token',
      applicationId: '456',
      siteId: 'MLA',
      offset: 0
    });
  });

  it('fails closed when authenticated identity has no usable site', async () => {
    const test = setup();
    test.identity.getCurrentUser.mockResolvedValue({
      externalAccountId: '123',
      displayName: 'Seller',
      siteId: 'invalid'
    });

    await expect(test.service.recoverItems({ organizationId, connectionId })).rejects.toMatchObject(
      { code: 'identity_lookup_failed' }
    );
    expect(test.feeds.getItemsPage).not.toHaveBeenCalled();
  });

  it.each([
    ['user', { user_id: '999' }],
    ['application', { application_id: '999' }],
    ['site', { resource: '/items/MLB123456' }]
  ] as const)('denies a wrong %s binding before intake', async (_label, change) => {
    const test = setup([{ ...message(), ...change }]);
    await expect(test.service.recoverItems({ organizationId, connectionId })).rejects.toMatchObject(
      { code: 'connection_binding_invalid' }
    );
    expect(test.intake.intakeItemsNotification).not.toHaveBeenCalled();
  });

  it('denies a cross-tenant Connection lookup before credentials', async () => {
    const test = setup();
    test.connections.getById.mockResolvedValue(null);

    await expect(
      test.service.recoverItems({
        organizationId: 'org_other',
        connectionId
      })
    ).rejects.toMatchObject({ code: 'connection_not_found' });
    expect(test.credentials.getValidAccessToken).not.toHaveBeenCalled();
  });

  it('paginates with fixed offsets and a bounded final page', async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) =>
      message(`feed-${index}`, `MLA${100000 + index}`)
    );
    const test = setup(firstPage);
    test.feeds.getItemsPage
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([message('feed-final', 'MLA999999')]);

    await expect(
      test.service.recoverItems({ organizationId, connectionId })
    ).resolves.toMatchObject({
      pages: 2,
      accepted: 11,
      duplicates: 0,
      exhausted: true,
      nextOffset: null
    });
    expect(test.feeds.getItemsPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offset: 10 })
    );
  });

  it('fails closed on a repeated full page', async () => {
    const fullPage = Array.from({ length: 10 }, (_, index) =>
      message(`feed-${index}`, `MLA${100000 + index}`)
    );
    const test = setup(fullPage);

    await expect(
      test.service.recoverItems({ organizationId, connectionId })
    ).rejects.toBeInstanceOf(MercadoLibreMissedFeedsError);
    expect(test.feeds.getItemsPage).toHaveBeenCalledTimes(2);
  });

  it('returns an explicit continuation offset at the bounded page limit', async () => {
    const test = setup();
    test.feeds.getItemsPage.mockImplementation(({ offset }: { offset: number }) =>
      Promise.resolve(
        Array.from({ length: 10 }, (_, index) =>
          message(`feed-${offset + index}`, `MLA${100000 + offset + index}`)
        )
      )
    );

    await expect(
      test.service.recoverItems({ organizationId, connectionId })
    ).resolves.toMatchObject({
      pages: 10,
      accepted: 100,
      duplicates: 0,
      exhausted: false,
      nextOffset: 100
    });
  });

  it('honors a smaller orchestration page budget', async () => {
    const test = setup();
    test.feeds.getItemsPage.mockImplementation(({ offset }: { offset: number }) =>
      Promise.resolve(
        Array.from({ length: 10 }, (_, index) =>
          message(`feed-${offset + index}`, `MLA${100000 + offset + index}`)
        )
      )
    );

    await expect(
      test.service.recoverItems({ organizationId, connectionId, maxPages: 2 })
    ).resolves.toMatchObject({ pages: 2, exhausted: false, nextOffset: 20 });
    expect(test.feeds.getItemsPage).toHaveBeenCalledTimes(2);
  });
});
