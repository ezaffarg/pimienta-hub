import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  MercadoLibreMissedFeedsClient,
  MercadoLibreMissedFeedsError,
  MercadoLibreMissedFeedRecoveryService
} from './missed-feeds';
import { MercadoLibreCredentialError } from '../auth';

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
  const credentials = {
    getValidAccessToken: vi
      .fn()
      .mockImplementation(
        async (
          _scope: unknown,
          observe?: (diagnostics: {
            failureStage: null;
            casFailure: null;
            providerCallsAttempted: number;
            providerCallsSucceeded: number;
          }) => void
        ) => {
          observe?.({
            failureStage: null,
            casFailure: null,
            providerCallsAttempted: 0,
            providerCallsSucceeded: 0
          });
          return 'test-token';
        }
      )
  };
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

function providerMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { externalEventId: _id, ...notification } = message();
  return { _id, ...notification, ...overrides };
}

function requestProviderPage(payload: unknown) {
  const client = new MercadoLibreMissedFeedsClient(
    vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)))
  );
  return client.getItemsPage({
    accessToken: 'test-token',
    applicationId: '456',
    siteId: 'MLA',
    offset: 0
  });
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

  it('accepts an items missed-feed message without provider _id', async () => {
    const { externalEventId: _externalEventId, ...notification } = message();
    const client = new MercadoLibreMissedFeedsClient(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            messages: [{ ...notification, request: null, response: { http_code: 503 } }]
          })
        )
      )
    );

    await expect(
      client.getItemsPage({
        accessToken: 'test-token',
        applicationId: '456',
        siteId: 'MLA',
        offset: 0
      })
    ).resolves.toEqual([notification]);
  });

  it('normalizes numeric provider identities while ignoring provider-owned fields', async () => {
    const client = new MercadoLibreMissedFeedsClient(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            messages: [
              {
                ...message(),
                _id: 'feed-1',
                user_id: 123,
                application_id: 456,
                request: { headers: { authorization: 'not-projected' } },
                response: null
              }
            ],
            paging: { offset: 0, limit: 10, total: 1 }
          })
        )
      )
    );

    await expect(
      client.getItemsPage({
        accessToken: 'test-token',
        applicationId: '456',
        siteId: 'MLA',
        offset: 0
      })
    ).resolves.toEqual([message()]);
  });

  it.each([
    ['resource', 'RESPONSE_SCHEMA_RESOURCE'],
    ['user_id', 'RESPONSE_SCHEMA_USER_ID'],
    ['topic', 'RESPONSE_SCHEMA_TOPIC'],
    ['application_id', 'RESPONSE_SCHEMA_APPLICATION_ID'],
    ['attempts', 'RESPONSE_SCHEMA_ATTEMPTS'],
    ['sent', 'RESPONSE_SCHEMA_SENT'],
    ['received', 'RESPONSE_SCHEMA_RECEIVED']
  ] as const)('classifies an omitted required %s field', async (field, responseSchemaCategory) => {
    const fixture = providerMessage();
    delete fixture[field];

    await expect(requestProviderPage({ messages: [fixture] })).rejects.toMatchObject({
      code: 'provider_response_invalid',
      responseSubdiagnostic: 'RESPONSE_SCHEMA',
      responseSchemaCategory,
      responseMessagesDetail: null
    });
  });

  it.each([
    ['resource', { resource: '/orders/123' }, 'RESPONSE_SCHEMA_RESOURCE'],
    ['user_id', { user_id: null }, 'RESPONSE_SCHEMA_USER_ID'],
    ['topic', { topic: 'orders' }, 'RESPONSE_SCHEMA_TOPIC'],
    ['application_id', { application_id: {} }, 'RESPONSE_SCHEMA_APPLICATION_ID'],
    ['attempts', { attempts: 0 }, 'RESPONSE_SCHEMA_ATTEMPTS'],
    ['sent', { sent: 'not-a-timestamp' }, 'RESPONSE_SCHEMA_SENT'],
    ['received', { received: 'not-a-timestamp' }, 'RESPONSE_SCHEMA_RECEIVED']
  ] as const)('classifies a malformed %s field', async (_field, change, responseSchemaCategory) => {
    await expect(
      requestProviderPage({ messages: [providerMessage(change)] })
    ).rejects.toMatchObject({
      code: 'provider_response_invalid',
      responseSubdiagnostic: 'RESPONSE_SCHEMA',
      responseSchemaCategory,
      responseMessagesDetail: null
    });
  });

  it.each([
    ['missing messages', {}, 'RESPONSE_SCHEMA_MESSAGES', 'MESSAGES_MISSING'],
    [
      'string messages',
      { messages: 'not-an-array' },
      'RESPONSE_SCHEMA_MESSAGES',
      'MESSAGES_WRONG_TYPE'
    ],
    ['numeric messages', { messages: 123 }, 'RESPONSE_SCHEMA_MESSAGES', 'MESSAGES_WRONG_TYPE'],
    ['object messages', { messages: {} }, 'RESPONSE_SCHEMA_MESSAGES', 'MESSAGES_WRONG_TYPE'],
    [
      'malformed message element',
      { messages: [null] },
      'RESPONSE_SCHEMA_MESSAGES',
      'MESSAGES_ELEMENT'
    ],
    ['malformed top level', 'not-an-object', 'RESPONSE_SCHEMA_TOP_LEVEL', null],
    [
      'too many messages',
      { messages: Array.from({ length: 11 }, () => providerMessage()) },
      'RESPONSE_SCHEMA_MESSAGES',
      'MESSAGES_LENGTH'
    ]
  ] as const)(
    'classifies a %s response wrapper',
    async (_label, payload, responseSchemaCategory, responseMessagesDetail) => {
      await expect(requestProviderPage(payload)).rejects.toMatchObject({
        code: 'provider_response_invalid',
        responseSubdiagnostic: 'RESPONSE_SCHEMA',
        responseSchemaCategory,
        responseMessagesDetail
      });
    }
  );

  it.each([
    ['an empty messages array', 0],
    ['the requested page limit', 10]
  ] as const)('accepts %s', async (_label, count) => {
    const messages = Array.from({ length: count }, (_, index) =>
      providerMessage({ _id: `feed-${index}`, resource: `/items/MLA${100000 + index}` })
    );

    await expect(requestProviderPage({ messages })).resolves.toHaveLength(count);
  });

  it('normalizes null messages to an empty canonical page', async () => {
    await expect(requestProviderPage({ messages: null })).resolves.toEqual([]);
  });

  it('chooses the first allowlisted priority for multiple schema issues', async () => {
    await expect(
      requestProviderPage({
        messages: [providerMessage({ resource: '/orders/123', sent: 'not-a-timestamp' })]
      })
    ).rejects.toMatchObject({
      responseSubdiagnostic: 'RESPONSE_SCHEMA',
      responseSchemaCategory: 'RESPONSE_SCHEMA_RESOURCE'
    });
  });

  it('chooses the fixed messages-detail priority for multiple messages issues', async () => {
    await expect(
      requestProviderPage({
        messages: [null, ...Array.from({ length: 10 }, () => providerMessage())]
      })
    ).rejects.toMatchObject({
      responseSchemaCategory: 'RESPONSE_SCHEMA_MESSAGES',
      responseMessagesDetail: 'MESSAGES_LENGTH'
    });
  });

  it('classifies an unsupported message field path without exposing its details', async () => {
    await expect(
      requestProviderPage({ messages: [providerMessage({ _id: '' })] })
    ).rejects.toMatchObject({
      responseSubdiagnostic: 'RESPONSE_SCHEMA',
      responseSchemaCategory: 'RESPONSE_SCHEMA_OTHER'
    });
  });

  it.each([
    ['malformed JSON', '{', 'RESPONSE_JSON'],
    ['empty response', '', 'RESPONSE_JSON'],
    [
      'provider error envelope',
      JSON.stringify({ message: 'invalid app', error: 'bad_request' }),
      'RESPONSE_SCHEMA'
    ],
    ['unexpected wrapper', JSON.stringify({ results: [] }), 'RESPONSE_SCHEMA']
  ] as const)(
    'fails closed on a 2xx %s as an accepted provider response',
    async (_label, body, responseSubdiagnostic) => {
      const client = new MercadoLibreMissedFeedsClient(
        vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
      );

      await expect(
        client.getItemsPage({
          accessToken: 'test-token',
          applicationId: '456',
          siteId: 'MLA',
          offset: 0
        })
      ).rejects.toMatchObject({
        code: 'provider_response_invalid',
        providerCallSucceeded: true,
        responseSubdiagnostic
      });
    }
  );

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
    expect(error).toMatchObject({
      code: 'provider_response_invalid',
      responseSubdiagnostic: 'RESPONSE_SCHEMA'
    });
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
      nextOffset: null,
      providerCallsAttempted: 2,
      providerCallsSucceeded: 2,
      credentialRefreshFailureStage: null,
      credentialRefreshCasFailure: null,
      credentialRefreshCallsAttempted: 0,
      credentialRefreshCallsSucceeded: 0
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

  it('passes only the canonical credential scope when pagination is present', async () => {
    const test = setup([]);

    await test.service.recoverItems({ organizationId, connectionId, offset: 20, maxPages: 1 });

    expect(test.credentials.getValidAccessToken).toHaveBeenCalledWith(
      { organizationId, connectionId },
      expect.any(Function)
    );
  });

  it('preserves an identity request failure before any missed-feed page attempt', async () => {
    const test = setup();
    test.identity.getCurrentUser.mockRejectedValue(new Error('raw identity payload'));

    const error = await test.service
      .recoverItems({ organizationId, connectionId })
      .catch((cause) => cause);

    expect(error).toMatchObject({
      code: 'identity_lookup_failed',
      failureStage: 'identity_request',
      providerCallsAttempted: 1,
      providerCallsSucceeded: 0
    });
    expect(test.identity.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(test.feeds.getItemsPage).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain('payload');
  });

  it('records credential failure before any provider call', async () => {
    const test = setup();
    test.credentials.getValidAccessToken.mockRejectedValue(
      new MercadoLibreCredentialError('PROVIDER_HTTP_ERROR', 'PROVIDER_RESPONSE', {
        refreshFailureStage: 'refresh_provider_response',
        refreshCallsAttempted: 1,
        refreshCallsSucceeded: 0
      })
    );

    const error = await test.service
      .recoverItems({ organizationId, connectionId })
      .catch((cause) => cause);

    expect(error).toMatchObject({
      code: 'credential_failed',
      failureStage: 'credential_resolution',
      providerCallsAttempted: 0,
      providerCallsSucceeded: 0,
      credentialRefreshFailureStage: 'refresh_provider_response',
      credentialRefreshCasFailure: null,
      credentialRefreshCallsAttempted: 1,
      credentialRefreshCallsSucceeded: 0
    });
    expect(test.identity.getCurrentUser).not.toHaveBeenCalled();
    expect(test.feeds.getItemsPage).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain('material');
  });

  it.each(['CAS_RPC_THROW', 'CAS_RPC_ERROR', 'CAS_RESPONSE_INVALID', 'CAS_CONFLICT'] as const)(
    'preserves credential refresh subtype %s before any provider call',
    async (casFailure) => {
      const test = setup();
      test.credentials.getValidAccessToken.mockRejectedValue(
        new MercadoLibreCredentialError('REFRESH_COMPLETE_RPC_FAILED', 'CAS_COMPLETE', {
          refreshFailureStage: 'refresh_cas',
          casFailure,
          refreshCallsAttempted: 1,
          refreshCallsSucceeded: 1
        })
      );

      const error = await test.service
        .recoverItems({ organizationId, connectionId })
        .catch((cause) => cause);

      expect(error).toMatchObject({
        code: 'credential_failed',
        failureStage: 'credential_resolution',
        providerCallsAttempted: 0,
        providerCallsSucceeded: 0,
        credentialRefreshFailureStage: 'refresh_cas',
        credentialRefreshCasFailure: casFailure,
        credentialRefreshCallsAttempted: 1,
        credentialRefreshCallsSucceeded: 1
      });
      expect(test.identity.getCurrentUser).not.toHaveBeenCalled();
      expect(test.feeds.getItemsPage).not.toHaveBeenCalled();
    }
  );

  it('preserves a missed-feed HTTP failure after one identity and page attempt', async () => {
    const test = setup();
    test.feeds.getItemsPage.mockRejectedValue(
      new MercadoLibreMissedFeedsError('provider_unavailable')
    );

    await expect(test.service.recoverItems({ organizationId, connectionId })).rejects.toMatchObject(
      {
        code: 'provider_unavailable',
        failureStage: 'missed_feed_request',
        providerCallsAttempted: 2,
        providerCallsSucceeded: 1
      }
    );
    expect(test.identity.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(test.feeds.getItemsPage).toHaveBeenCalledTimes(1);
    expect(test.intake.intakeItemsNotification).not.toHaveBeenCalled();
  });

  it.each([
    ['RESPONSE_JSON', '{', null, null, null],
    [
      'RESPONSE_SCHEMA',
      JSON.stringify({ results: [] }),
      'RESPONSE_SCHEMA_MESSAGES',
      'MESSAGES_MISSING',
      null
    ],
    [
      'RESPONSE_SCHEMA',
      JSON.stringify({ messages: 'SECRET_RAW_MESSAGES' }),
      'RESPONSE_SCHEMA_MESSAGES',
      'MESSAGES_WRONG_TYPE',
      'SECRET_RAW_MESSAGES'
    ],
    [
      'RESPONSE_SCHEMA',
      JSON.stringify({ messages: Array.from({ length: 11 }, () => providerMessage()) }),
      'RESPONSE_SCHEMA_MESSAGES',
      'MESSAGES_LENGTH',
      null
    ],
    [
      'RESPONSE_SCHEMA',
      JSON.stringify({ messages: [null] }),
      'RESPONSE_SCHEMA_MESSAGES',
      'MESSAGES_ELEMENT',
      null
    ]
  ] as const)(
    'emits one safe %s diagnostic before rejecting',
    async (subdiagnostic, body, responseSchemaCategory, responseMessagesDetail, forbidden) => {
      const test = setup();
      const log = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const service = new MercadoLibreMissedFeedRecoveryService({
        connections: test.connections as never,
        credentials: test.credentials,
        identity: test.identity,
        feeds: new MercadoLibreMissedFeedsClient(
          vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
        ),
        intake: test.intake,
        applicationId: () => '456'
      });

      await expect(service.recoverItems({ organizationId, connectionId })).rejects.toMatchObject({
        code: 'provider_response_invalid',
        failureStage: 'missed_feed_response',
        providerCallsAttempted: 2,
        providerCallsSucceeded: 2,
        responseSubdiagnostic: subdiagnostic,
        responseSchemaCategory,
        responseMessagesDetail
      });
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        `${JSON.stringify({
          component: 'meli-missed-feed',
          failureStage: 'missed_feed_response',
          subdiagnostic,
          ...(responseSchemaCategory === null ? {} : { schemaCategory: responseSchemaCategory }),
          ...(responseMessagesDetail === null ? {} : { messagesDetail: responseMessagesDetail })
        })}\n`
      );
      if (forbidden !== null) expect(JSON.stringify(log.mock.calls)).not.toContain(forbidden);
      log.mockRestore();
    }
  );

  it('logs only an allowlisted schema category and stops before intake', async () => {
    const test = setup();
    const log = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const rawIdentifier = 'SECRET_RAW_IDENTIFIER';
    const service = new MercadoLibreMissedFeedRecoveryService({
      connections: test.connections as never,
      credentials: test.credentials,
      identity: test.identity,
      feeds: new MercadoLibreMissedFeedsClient(
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ messages: [providerMessage({ resource: rawIdentifier })] })
            )
          )
      ),
      intake: test.intake,
      applicationId: () => '456'
    });

    await expect(service.recoverItems({ organizationId, connectionId })).rejects.toMatchObject({
      responseSubdiagnostic: 'RESPONSE_SCHEMA',
      responseSchemaCategory: 'RESPONSE_SCHEMA_RESOURCE'
    });
    expect(test.intake.intakeItemsNotification).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      `${JSON.stringify({
        component: 'meli-missed-feed',
        failureStage: 'missed_feed_response',
        subdiagnostic: 'RESPONSE_SCHEMA',
        schemaCategory: 'RESPONSE_SCHEMA_RESOURCE'
      })}\n`
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(rawIdentifier);
    log.mockRestore();
  });

  it('lets a valid response schema proceed to binding validation', async () => {
    const test = setup();
    const log = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const service = new MercadoLibreMissedFeedRecoveryService({
      connections: test.connections as never,
      credentials: test.credentials,
      identity: test.identity,
      feeds: new MercadoLibreMissedFeedsClient(
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ messages: [providerMessage({ user_id: 999 })] }))
          )
      ),
      intake: test.intake,
      applicationId: () => '456'
    });

    await expect(service.recoverItems({ organizationId, connectionId })).rejects.toMatchObject({
      code: 'connection_binding_invalid',
      responseSubdiagnostic: 'RESPONSE_BINDING',
      responseSchemaCategory: null
    });
    expect(test.intake.intakeItemsNotification).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      `${JSON.stringify({
        component: 'meli-missed-feed',
        failureStage: 'missed_feed_response',
        subdiagnostic: 'RESPONSE_BINDING'
      })}\n`
    );
    log.mockRestore();
  });

  it('records a successful zero-event page without intake work', async () => {
    const test = setup([]);

    await expect(test.service.recoverItems({ organizationId, connectionId })).resolves.toEqual({
      pages: 1,
      accepted: 0,
      duplicates: 0,
      exhausted: true,
      nextOffset: null,
      providerCallsAttempted: 2,
      providerCallsSucceeded: 2,
      credentialRefreshFailureStage: null,
      credentialRefreshCasFailure: null,
      credentialRefreshCallsAttempted: 0,
      credentialRefreshCallsSucceeded: 0
    });
    expect(test.identity.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(test.feeds.getItemsPage).toHaveBeenCalledTimes(1);
    expect(test.intake.intakeItemsNotification).not.toHaveBeenCalled();
  });

  it('treats null provider messages as the canonical empty-page recovery path', async () => {
    const test = setup();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: null })));
    const service = new MercadoLibreMissedFeedRecoveryService({
      connections: test.connections as never,
      credentials: test.credentials,
      identity: test.identity,
      feeds: new MercadoLibreMissedFeedsClient(fetcher),
      intake: test.intake,
      applicationId: () => '456'
    });

    await expect(service.recoverItems({ organizationId, connectionId })).resolves.toEqual({
      pages: 1,
      accepted: 0,
      duplicates: 0,
      exhausted: true,
      nextOffset: null,
      providerCallsAttempted: 2,
      providerCallsSucceeded: 2,
      credentialRefreshFailureStage: null,
      credentialRefreshCasFailure: null,
      credentialRefreshCallsAttempted: 0,
      credentialRefreshCallsSucceeded: 0
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(test.intake.intakeItemsNotification).not.toHaveBeenCalled();
  });

  it('accepts the runtime-shaped 2xx response without _id through recovery', async () => {
    const test = setup();
    const { externalEventId: _externalEventId, ...notification } = message();
    const service = new MercadoLibreMissedFeedRecoveryService({
      connections: test.connections as never,
      credentials: test.credentials,
      identity: test.identity,
      feeds: new MercadoLibreMissedFeedsClient(
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              messages: [{ ...notification, request: null, response: { http_code: 503 } }]
            })
          )
        )
      ),
      intake: test.intake,
      applicationId: () => '456'
    });

    await expect(service.recoverItems({ organizationId, connectionId })).resolves.toMatchObject({
      pages: 1,
      accepted: 1,
      providerCallsAttempted: 2,
      providerCallsSucceeded: 2
    });
    expect(test.intake.intakeItemsNotification).toHaveBeenCalledWith(notification);
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
    const log = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(test.service.recoverItems({ organizationId, connectionId })).rejects.toMatchObject(
      {
        code: 'connection_binding_invalid',
        failureStage: 'missed_feed_response',
        responseSubdiagnostic: 'RESPONSE_BINDING'
      }
    );
    expect(test.intake.intakeItemsNotification).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      `${JSON.stringify({
        component: 'meli-missed-feed',
        failureStage: 'missed_feed_response',
        subdiagnostic: 'RESPONSE_BINDING'
      })}\n`
    );
    log.mockRestore();
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

    await expect(test.service.recoverItems({ organizationId, connectionId })).rejects.toMatchObject(
      {
        code: 'pagination_loop',
        failureStage: 'missed_feed_pagination',
        providerCallsAttempted: 3,
        providerCallsSucceeded: 3
      }
    );
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
