import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import { IntegrationEventRepository } from './integration-event-repository';

const envelope = {
  organizationId: 'org_test',
  storeId: '10000000-0000-4000-8000-000000000001',
  connectionId: '10000000-0000-4000-8000-000000000002',
  provider: 'mercado-libre' as const,
  topic: 'items',
  resource: '/items/MLA123456',
  externalResourceId: 'MLA123456',
  externalEventId: 'event-1',
  dedupeKey: 'a'.repeat(64),
  providerUserId: '123',
  applicationId: '456',
  providerSentAt: '2026-08-28T12:00:00.000Z',
  providerReceivedAt: '2026-08-28T12:00:01.000Z',
  deliveryAttempts: 1
};

function eventRow(outcome: 'accepted' | 'duplicate') {
  return {
    outcome,
    id: '10000000-0000-4000-8000-000000000003',
    organization_id: envelope.organizationId,
    store_id: envelope.storeId,
    connection_id: envelope.connectionId,
    provider: envelope.provider,
    topic: envelope.topic,
    resource: envelope.resource,
    external_resource_id: envelope.externalResourceId,
    external_event_id: envelope.externalEventId,
    dedupe_key: envelope.dedupeKey,
    provider_user_id: envelope.providerUserId,
    application_id: envelope.applicationId,
    provider_sent_at: envelope.providerSentAt,
    provider_received_at: envelope.providerReceivedAt,
    received_at: '2026-08-28T12:00:02.000Z',
    status: 'received',
    delivery_attempts: 1,
    processed_at: null,
    safe_error_code: null,
    created_at: '2026-08-28T12:00:02.000Z',
    updated_at: '2026-08-28T12:00:02.000Z'
  };
}

describe('IntegrationEventRepository', () => {
  it.each([
    ['accepted', 'ACCEPTED'],
    ['duplicate', 'DUPLICATE']
  ] as const)(
    'maps the controlled %s outcome and all canonical RPC fields',
    async (raw, outcome) => {
      const rpc = vi.fn().mockResolvedValue({ data: [eventRow(raw)], error: null });
      const repository = new IntegrationEventRepository({ rpc } as unknown as SupabaseClient);

      await expect(repository.intake(envelope)).resolves.toMatchObject({
        outcome,
        event: {
          organizationId: envelope.organizationId,
          connectionId: envelope.connectionId,
          status: 'received'
        }
      });
      expect(rpc).toHaveBeenCalledWith('intake_integration_event', {
        p_organization_id: envelope.organizationId,
        p_store_id: envelope.storeId,
        p_connection_id: envelope.connectionId,
        p_provider: envelope.provider,
        p_topic: envelope.topic,
        p_resource: envelope.resource,
        p_external_resource_id: envelope.externalResourceId,
        p_external_event_id: envelope.externalEventId,
        p_dedupe_key: envelope.dedupeKey,
        p_provider_user_id: envelope.providerUserId,
        p_application_id: envelope.applicationId,
        p_provider_sent_at: envelope.providerSentAt,
        p_provider_received_at: envelope.providerReceivedAt,
        p_delivery_attempts: envelope.deliveryAttempts
      });
    }
  );

  it.each([
    { response: () => Promise.reject(new Error('raw transport detail')), message: 'RPC failed' },
    {
      response: () => Promise.resolve({ data: null, error: { message: 'raw SQL detail' } }),
      message: 'failed'
    },
    { response: () => Promise.resolve({ data: [], error: null }), message: 'response invalid' }
  ])('sanitizes persistence failure: $message', async ({ response }) => {
    const repository = new IntegrationEventRepository({
      rpc: vi.fn().mockImplementation(response)
    } as unknown as SupabaseClient);
    const error = await repository.intake(envelope).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ name: 'PersistenceError' });
    expect(JSON.stringify(error)).not.toContain('raw');
  });

  it('rejects non-canonical envelopes before calling the RPC', async () => {
    const rpc = vi.fn();
    const repository = new IntegrationEventRepository({ rpc } as unknown as SupabaseClient);

    await expect(
      repository.intake({ ...envelope, callerOrganizationId: 'other' } as never)
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
