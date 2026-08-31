import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { IntegrationProvider } from '@/integrations/core';
import { getSupabaseServerClient } from './supabase-server';
import { PersistenceError, type ListingScope } from './repositories';

export type IntegrationEventStatus = 'received' | 'processing' | 'processed' | 'failed';
export type IntegrationEventIntakeOutcome = 'ACCEPTED' | 'DUPLICATE';

export interface IntegrationEventEnvelope extends ListingScope {
  provider: IntegrationProvider;
  topic: string;
  resource: string;
  externalResourceId: string;
  externalEventId: string | null;
  dedupeKey: string;
  providerUserId: string;
  applicationId: string;
  providerSentAt: string;
  providerReceivedAt: string | null;
  deliveryAttempts: number;
}

export interface IntegrationEventRecord extends IntegrationEventEnvelope {
  id: string;
  receivedAt: string;
  status: IntegrationEventStatus;
  processedAt: string | null;
  safeErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationEventIntakeResult {
  outcome: IntegrationEventIntakeOutcome;
  event: IntegrationEventRecord;
}

export class IntegrationEventRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServerClient()) {}

  async intake(envelope: IntegrationEventEnvelope): Promise<IntegrationEventIntakeResult> {
    const parsed = integrationEventEnvelopeSchema.parse(envelope);
    let response;
    try {
      response = await this.client.rpc('intake_integration_event', {
        p_organization_id: parsed.organizationId,
        p_store_id: parsed.storeId,
        p_connection_id: parsed.connectionId,
        p_provider: parsed.provider,
        p_topic: parsed.topic,
        p_resource: parsed.resource,
        p_external_resource_id: parsed.externalResourceId,
        p_external_event_id: parsed.externalEventId,
        p_dedupe_key: parsed.dedupeKey,
        p_provider_user_id: parsed.providerUserId,
        p_application_id: parsed.applicationId,
        p_provider_sent_at: parsed.providerSentAt,
        p_provider_received_at: parsed.providerReceivedAt,
        p_delivery_attempts: parsed.deliveryAttempts
      });
    } catch {
      throw new PersistenceError('Integration event intake RPC failed');
    }
    if (response.error) throw new PersistenceError('Integration event intake failed');
    const rows = intakeRowsSchema.safeParse(response.data);
    if (!rows.success) throw new PersistenceError('Integration event intake response invalid');
    const row = rows.data[0];
    return {
      outcome: row.outcome === 'accepted' ? 'ACCEPTED' : 'DUPLICATE',
      event: integrationEventRecord(row)
    };
  }
}

const integrationEventEnvelopeSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    storeId: z.uuid(),
    connectionId: z.uuid(),
    provider: z.enum(['mercado-libre', 'shopify', 'tiendanube', 'woocommerce']),
    topic: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/),
    resource: z
      .string()
      .regex(/^\/\S+$/)
      .max(512),
    externalResourceId: z.string().trim().min(1).max(255),
    externalEventId: z.string().trim().min(1).max(255).nullable(),
    dedupeKey: z.string().regex(/^[0-9a-f]{64}$/),
    providerUserId: z.string().trim().min(1).max(255),
    applicationId: z.string().trim().min(1).max(255),
    providerSentAt: z.iso.datetime({ offset: true }),
    providerReceivedAt: z.iso.datetime({ offset: true }).nullable(),
    deliveryAttempts: z.number().int().positive()
  })
  .strict();

const timestampSchema = z.iso.datetime({ offset: true });
const eventRowSchema = z.object({
  id: z.uuid(),
  organization_id: z.string().trim().min(1).max(255),
  store_id: z.uuid(),
  connection_id: z.uuid(),
  provider: z.enum(['mercado-libre', 'shopify', 'tiendanube', 'woocommerce']),
  topic: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/),
  resource: z.string().min(1).max(512),
  external_resource_id: z.string().trim().min(1).max(255),
  external_event_id: z.string().trim().min(1).max(255).nullable(),
  dedupe_key: z.string().regex(/^[0-9a-f]{64}$/),
  provider_user_id: z.string().trim().min(1).max(255),
  application_id: z.string().trim().min(1).max(255),
  provider_sent_at: timestampSchema,
  provider_received_at: timestampSchema.nullable(),
  received_at: timestampSchema,
  status: z.enum(['received', 'processing', 'processed', 'failed']),
  delivery_attempts: z.number().int().positive(),
  processed_at: timestampSchema.nullable(),
  safe_error_code: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema
});
const intakeRowsSchema = z
  .array(eventRowSchema.extend({ outcome: z.enum(['accepted', 'duplicate']) }))
  .length(1);

function integrationEventRecord(row: z.infer<typeof eventRowSchema>): IntegrationEventRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    storeId: row.store_id,
    connectionId: row.connection_id,
    provider: row.provider,
    topic: row.topic,
    resource: row.resource,
    externalResourceId: row.external_resource_id,
    externalEventId: row.external_event_id,
    dedupeKey: row.dedupe_key,
    providerUserId: row.provider_user_id,
    applicationId: row.application_id,
    providerSentAt: row.provider_sent_at,
    providerReceivedAt: row.provider_received_at,
    receivedAt: row.received_at,
    status: row.status,
    deliveryAttempts: row.delivery_attempts,
    processedAt: row.processed_at,
    safeErrorCode: row.safe_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
