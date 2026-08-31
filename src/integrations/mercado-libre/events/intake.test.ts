import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { MercadoLibreEventIntakeService, parseMercadoLibreItemsNotification } from './intake';

const payload = {
  _id: 'event-1',
  resource: '/items/MLA123456',
  user_id: 123,
  topic: 'items',
  application_id: 456,
  attempts: 1,
  sent: '2026-08-28T12:00:00.000Z',
  received: '2026-08-28T12:00:01.000Z'
};
const connection = {
  id: '10000000-0000-4000-8000-000000000001',
  organizationId: 'org_test',
  storeId: '10000000-0000-4000-8000-000000000002',
  provider: 'mercado-libre' as const,
  externalAccountId: '123',
  status: 'active' as const,
  scopes: [],
  expiresAt: null
};

function setup(resolvedConnection: typeof connection | null = connection) {
  const connections = {
    findByProviderAndExternalAccount: vi.fn().mockResolvedValue(resolvedConnection)
  };
  const events = {
    intake: vi.fn().mockResolvedValue({ outcome: 'ACCEPTED', event: { id: 'event-row' } })
  };
  return {
    service: new MercadoLibreEventIntakeService({
      applicationId: () => '456',
      connections,
      events: events as never
    }),
    connections,
    events
  };
}

describe('parseMercadoLibreItemsNotification', () => {
  it('normalizes the strict items envelope without retaining raw data', () => {
    const event = parseMercadoLibreItemsNotification(payload, '456');

    expect(event).toMatchObject({
      provider: 'mercado-libre',
      topic: 'items',
      externalResourceId: 'MLA123456',
      externalEventId: 'event-1',
      providerUserId: '123',
      applicationId: '456'
    });
    expect(Object.keys(event).toSorted()).toEqual(
      [
        'applicationId',
        'dedupeKey',
        'deliveryAttempts',
        'externalEventId',
        'externalResourceId',
        'provider',
        'providerReceivedAt',
        'providerSentAt',
        'providerUserId',
        'resource',
        'topic'
      ].toSorted()
    );
  });

  it('uses external event identity when _id is present', () => {
    const first = parseMercadoLibreItemsNotification(payload, '456');
    const retry = parseMercadoLibreItemsNotification(
      { ...payload, attempts: 8, received: '2026-08-28T13:00:00.000Z' },
      '456'
    );
    const expected = createHash('sha256')
      .update(JSON.stringify(['external-event', 'mercado-libre', '456', 'event-1']))
      .digest('hex');
    expect(first.dedupeKey).toBe(expected);
    expect(retry.dedupeKey).toBe(first.dedupeKey);
  });

  it('uses a deterministic fallback without attempts or provider received time', () => {
    const { _id: ignored, ...withoutId } = payload;
    const first = parseMercadoLibreItemsNotification(withoutId, '456');
    const retry = parseMercadoLibreItemsNotification(
      { ...withoutId, attempts: 3, received: '2026-08-28T13:00:00.000Z' },
      '456'
    );
    const other = parseMercadoLibreItemsNotification(
      { ...withoutId, resource: '/items/MLA999999' },
      '456'
    );

    expect(first.externalEventId).toBeNull();
    expect(first.dedupeKey).toBe(
      createHash('sha256')
        .update(
          JSON.stringify([
            'fallback',
            'mercado-libre',
            'items',
            '456',
            '123',
            '/items/MLA123456',
            '2026-08-28T12:00:00.000Z'
          ])
        )
        .digest('hex')
    );
    expect(retry.dedupeKey).toBe(first.dedupeKey);
    expect(other.dedupeKey).not.toBe(first.dedupeKey);
    expect(ignored).toBe('event-1');
  });

  it.each([
    ['topic', { ...payload, topic: 'orders' }],
    ['resource URL', { ...payload, resource: 'https://evil.example/items/MLA123456' }],
    ['resource suffix', { ...payload, resource: '/items/MLA123456?token=value' }],
    ['missing user', { ...payload, user_id: undefined }],
    ['timestamp', { ...payload, sent: 'not-a-date' }],
    ['extra field', { ...payload, organization_id: 'attacker-org' }]
  ])('rejects malformed %s fail-closed', (_label, invalid) => {
    expect(() => parseMercadoLibreItemsNotification(invalid, '456')).toThrow();
  });

  it('rejects an application mismatch with a safe error', () => {
    expect(() => parseMercadoLibreItemsNotification(payload, '999')).toThrow(
      'application_mismatch'
    );
  });
});

describe('MercadoLibreEventIntakeService', () => {
  it('resolves all tenant scope from the unique provider identity before intake', async () => {
    const test = setup();
    await expect(test.service.intakeItemsNotification(payload)).resolves.toMatchObject({
      outcome: 'ACCEPTED'
    });
    expect(test.connections.findByProviderAndExternalAccount).toHaveBeenCalledWith(
      'mercado-libre',
      '123'
    );
    expect(test.events.intake).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: connection.organizationId,
        storeId: connection.storeId,
        connectionId: connection.id,
        providerUserId: '123'
      })
    );
  });

  it('fails closed when no Connection resolves', async () => {
    const test = setup(null);
    await expect(test.service.intakeItemsNotification(payload)).rejects.toThrow(
      'connection_not_found'
    );
    expect(test.events.intake).not.toHaveBeenCalled();
  });

  it('fails closed when identity resolution is ambiguous or fails', async () => {
    const test = setup();
    test.connections.findByProviderAndExternalAccount.mockRejectedValue(new Error('multiple rows'));
    await expect(test.service.intakeItemsNotification(payload)).rejects.toThrow(
      'connection_resolution_failed'
    );
    expect(test.events.intake).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong provider', { ...connection, provider: 'shopify' as const }],
    ['wrong identity', { ...connection, externalAccountId: '999' }],
    ['disabled', { ...connection, status: 'disabled' as const }]
  ])('rejects an incompatible Connection: %s', async (_label, incompatible) => {
    const test = setup(incompatible as never);
    await expect(test.service.intakeItemsNotification(payload)).rejects.toThrow(
      'connection_binding_invalid'
    );
    expect(test.events.intake).not.toHaveBeenCalled();
  });

  it('rejects application mismatch and caller tenant fields before resolution', async () => {
    const test = setup();
    await expect(
      test.service.intakeItemsNotification({ ...payload, application_id: 999 })
    ).rejects.toThrow('application_mismatch');
    await expect(
      test.service.intakeItemsNotification({ ...payload, organizationId: 'other' })
    ).rejects.toThrow('payload_invalid');
    expect(test.connections.findByProviderAndExternalAccount).not.toHaveBeenCalled();
  });

  it('distinguishes invalid server configuration before parsing or resolution', async () => {
    const test = setup();
    const service = new MercadoLibreEventIntakeService({
      applicationId: () => {
        throw new Error('raw configuration detail');
      },
      connections: test.connections,
      events: test.events as never
    });

    await expect(service.intakeItemsNotification(payload)).rejects.toThrow('configuration_invalid');
    expect(test.connections.findByProviderAndExternalAccount).not.toHaveBeenCalled();
  });

  it('sanitizes repository failures', async () => {
    const test = setup();
    test.events.intake.mockRejectedValue(new Error('raw SQL detail'));
    const error = await test.service.intakeItemsNotification(payload).catch((cause) => cause);

    expect(error).toMatchObject({ code: 'intake_failed' });
    expect(JSON.stringify(error)).not.toContain('raw SQL detail');
  });
});
