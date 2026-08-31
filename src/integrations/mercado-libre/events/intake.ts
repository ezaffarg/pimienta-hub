import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  IntegrationEventRepository,
  type IntegrationEventEnvelope,
  type IntegrationEventIntakeResult
} from '@/infrastructure/database/integration-event-repository';
import { ConnectionRepository } from '@/infrastructure/database/repositories';

const MERCADO_LIBRE_PROVIDER = 'mercado-libre' as const;
const MERCADO_LIBRE_ITEMS_TOPIC = 'items' as const;
const itemResourcePattern = /^\/items\/([A-Z]{3}\d{1,32})$/;

const providerIdentitySchema = z.union([
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(String),
  z
    .string()
    .trim()
    .regex(/^\d{1,255}$/)
]);
const notificationSchema = z
  .object({
    _id: z.string().trim().min(1).max(255).optional(),
    resource: z.string().trim().min(1).max(512).regex(itemResourcePattern),
    user_id: providerIdentitySchema,
    topic: z.literal(MERCADO_LIBRE_ITEMS_TOPIC),
    application_id: providerIdentitySchema,
    attempts: z.number().int().positive(),
    sent: z.iso.datetime({ offset: true }),
    received: z.iso.datetime({ offset: true })
  })
  .strict();

export interface MercadoLibreItemsEvent {
  provider: typeof MERCADO_LIBRE_PROVIDER;
  topic: typeof MERCADO_LIBRE_ITEMS_TOPIC;
  resource: string;
  externalResourceId: string;
  externalEventId: string | null;
  dedupeKey: string;
  providerUserId: string;
  applicationId: string;
  providerSentAt: string;
  providerReceivedAt: string;
  deliveryAttempts: number;
}

export class MercadoLibreEventIntakeError extends Error {
  constructor(
    public readonly code:
      | 'payload_invalid'
      | 'application_mismatch'
      | 'configuration_invalid'
      | 'connection_not_found'
      | 'connection_resolution_failed'
      | 'connection_binding_invalid'
      | 'intake_failed'
  ) {
    super(code);
    this.name = 'MercadoLibreEventIntakeError';
  }
}

export function parseMercadoLibreItemsNotification(
  payload: unknown,
  expectedApplicationId: string
): MercadoLibreItemsEvent {
  const expected = providerIdentitySchema.parse(expectedApplicationId);
  const notification = notificationSchema.parse(payload);
  if (notification.application_id !== expected) {
    throw new MercadoLibreEventIntakeError('application_mismatch');
  }

  const resourceMatch = itemResourcePattern.exec(notification.resource)!;
  const { _id: providerEventId } = notification;
  const externalEventId = providerEventId ?? null;
  const dedupeMaterial = externalEventId
    ? ['external-event', MERCADO_LIBRE_PROVIDER, expected, externalEventId]
    : [
        'fallback',
        MERCADO_LIBRE_PROVIDER,
        MERCADO_LIBRE_ITEMS_TOPIC,
        expected,
        notification.user_id,
        notification.resource,
        notification.sent
      ];

  return {
    provider: MERCADO_LIBRE_PROVIDER,
    topic: MERCADO_LIBRE_ITEMS_TOPIC,
    resource: notification.resource,
    externalResourceId: resourceMatch[1],
    externalEventId,
    dedupeKey: createHash('sha256').update(JSON.stringify(dedupeMaterial)).digest('hex'),
    providerUserId: notification.user_id,
    applicationId: expected,
    providerSentAt: notification.sent,
    providerReceivedAt: notification.received,
    deliveryAttempts: notification.attempts
  };
}

export interface MercadoLibreEventIntakeDependencies {
  applicationId?: () => string;
  connections?: Pick<ConnectionRepository, 'findByProviderAndExternalAccount'>;
  events?: Pick<IntegrationEventRepository, 'intake'>;
}

export class MercadoLibreEventIntakeService {
  constructor(private readonly dependencies: MercadoLibreEventIntakeDependencies = {}) {}

  async intakeItemsNotification(payload: unknown): Promise<IntegrationEventIntakeResult> {
    let applicationId;
    try {
      applicationId = (this.dependencies.applicationId ?? configuredApplicationId)();
    } catch {
      throw new MercadoLibreEventIntakeError('configuration_invalid');
    }
    let event;
    try {
      event = parseMercadoLibreItemsNotification(payload, applicationId);
    } catch (error) {
      if (error instanceof MercadoLibreEventIntakeError) throw error;
      throw new MercadoLibreEventIntakeError('payload_invalid');
    }
    const connections = this.dependencies.connections ?? new ConnectionRepository();
    let connection;
    try {
      connection = await connections.findByProviderAndExternalAccount(
        MERCADO_LIBRE_PROVIDER,
        event.providerUserId
      );
    } catch {
      throw new MercadoLibreEventIntakeError('connection_resolution_failed');
    }
    if (!connection) throw new MercadoLibreEventIntakeError('connection_not_found');
    if (
      connection.provider !== MERCADO_LIBRE_PROVIDER ||
      connection.externalAccountId !== event.providerUserId ||
      connection.status !== 'active'
    ) {
      throw new MercadoLibreEventIntakeError('connection_binding_invalid');
    }

    const envelope: IntegrationEventEnvelope = {
      organizationId: connection.organizationId,
      storeId: connection.storeId,
      connectionId: connection.id,
      ...event
    };
    try {
      return await (this.dependencies.events ?? new IntegrationEventRepository()).intake(envelope);
    } catch {
      throw new MercadoLibreEventIntakeError('intake_failed');
    }
  }
}

function configuredApplicationId(): string {
  return providerIdentitySchema.parse(process.env.MERCADO_LIBRE_CLIENT_ID);
}
