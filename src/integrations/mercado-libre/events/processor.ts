import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  IntegrationEventProcessingRepository,
  type ClaimedIntegrationEvent,
  type IntegrationEventSafeErrorCode
} from '@/infrastructure/database/integration-event-processing-repository';
import { ConnectionRepository } from '@/infrastructure/database/repositories';
import { MercadoLibreCredentialError, MercadoLibreCredentialService } from '../auth';
import {
  MercadoLibreListingsClient,
  MercadoLibreListingsError,
  type MercadoLibreListingFailure
} from '../listings';

export type MercadoLibreEventProcessingOutcome =
  | 'APPLY'
  | 'STALE_NOOP'
  | 'EQUIVALENT_NOOP'
  | 'ALREADY_PROCESSED'
  | 'CLAIM_DENIED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT';

export interface MercadoLibreEventProcessingResult {
  outcome: MercadoLibreEventProcessingOutcome;
  processingAttempts: number | null;
  safeErrorCode: IntegrationEventSafeErrorCode | null;
}

export interface MercadoLibreEventProcessorDependencies {
  events?: Pick<IntegrationEventProcessingRepository, 'claim' | 'completeListing' | 'fail'>;
  connections?: Pick<ConnectionRepository, 'getById'>;
  credentials?: Pick<MercadoLibreCredentialService, 'getValidAccessToken'>;
  listings?: Pick<MercadoLibreListingsClient, 'getListingDetails'>;
  newLeaseId?: () => string;
  now?: () => Date;
}

export class MercadoLibreEventProcessingError extends Error {
  constructor(public readonly code: 'claim_failed' | 'failure_persistence_failed') {
    super(code);
    this.name = 'MercadoLibreEventProcessingError';
  }
}

export class MercadoLibreEventProcessor {
  private readonly events: Pick<
    IntegrationEventProcessingRepository,
    'claim' | 'completeListing' | 'fail'
  >;

  constructor(private readonly dependencies: MercadoLibreEventProcessorDependencies = {}) {
    this.events = dependencies.events ?? new IntegrationEventProcessingRepository();
  }

  async process(eventId: string): Promise<MercadoLibreEventProcessingResult> {
    const parsedEventId = z.uuid().parse(eventId);
    const leaseId = (this.dependencies.newLeaseId ?? randomUUID)();
    let claim;
    try {
      claim = await this.events.claim(parsedEventId, leaseId);
    } catch {
      throw new MercadoLibreEventProcessingError('claim_failed');
    }

    if (claim.outcome === 'ALREADY_PROCESSED') {
      return result('ALREADY_PROCESSED');
    }
    if (
      claim.outcome === 'ALREADY_PROCESSING' ||
      claim.outcome === 'NOT_YET_DUE' ||
      claim.outcome === 'NOT_FOUND'
    ) {
      return result('CLAIM_DENIED');
    }
    if (claim.outcome === 'NOT_RETRYABLE' || claim.outcome === 'BINDING_INVALID') {
      return result('FAILED_PERMANENT', null, 'connection_binding_invalid');
    }
    if (claim.outcome !== 'CLAIMED') return result('CLAIM_DENIED');

    const event = claim.event;
    if (
      event.provider !== 'mercado-libre' ||
      event.topic !== 'items' ||
      event.resource !== `/items/${event.externalResourceId}` ||
      !/^[A-Z]{3}\d{1,32}$/.test(event.externalResourceId)
    ) {
      return this.fail(event, leaseId, 'invalid_provider_response', false);
    }

    const connections = this.dependencies.connections ?? new ConnectionRepository();
    let connection;
    try {
      connection = await connections.getById(event.organizationId, event.connectionId);
    } catch {
      return this.fail(event, leaseId, 'persistence_failure', true);
    }
    if (
      !connection ||
      connection.organizationId !== event.organizationId ||
      connection.storeId !== event.storeId ||
      connection.provider !== 'mercado-libre' ||
      connection.externalAccountId !== event.providerUserId ||
      connection.status !== 'active'
    ) {
      return this.fail(event, leaseId, 'connection_binding_invalid', false);
    }

    const credentials = this.dependencies.credentials ?? new MercadoLibreCredentialService();
    let accessToken;
    try {
      accessToken = await credentials.getValidAccessToken({
        organizationId: event.organizationId,
        connectionId: event.connectionId
      });
    } catch (error) {
      const failure = credentialFailure(error);
      return this.fail(event, leaseId, failure.code, failure.retryable);
    }

    const listings = this.dependencies.listings ?? new MercadoLibreListingsClient();
    let details;
    try {
      details = await listings.getListingDetails({
        accessToken,
        itemIds: [event.externalResourceId]
      });
    } catch (error) {
      const failure = providerFailure(error);
      const retryAfterAt =
        failure.retryAfterMilliseconds === null
          ? null
          : new Date(
              (this.dependencies.now ?? (() => new Date()))().getTime() +
                failure.retryAfterMilliseconds
            ).toISOString();
      return this.fail(event, leaseId, failure.code, failure.retryable, retryAfterAt);
    }

    if (details.items.length !== 1 || details.failures.length !== 0) {
      const failure = details.failures[0]
        ? listingFailure(details.failures[0])
        : { code: 'invalid_provider_response' as const, retryable: false };
      return this.fail(event, leaseId, failure.code, failure.retryable);
    }

    const listing = details.items[0];
    if (listing.externalId !== event.externalResourceId || listing.providerUpdatedAt === null) {
      return this.fail(event, leaseId, 'ambiguous_provider_timestamp', false);
    }

    let freshness;
    try {
      freshness = await this.events.completeListing({
        eventId: event.id,
        leaseId,
        scope: event,
        listing,
        syncedAt: (this.dependencies.now ?? (() => new Date()))().toISOString()
      });
    } catch {
      return this.fail(event, leaseId, 'persistence_failure', true);
    }
    if (freshness === 'FRESHNESS_CONFLICT') {
      return this.fail(event, leaseId, 'ambiguous_provider_timestamp', false);
    }
    return result(freshness, event.processingAttempts);
  }

  private async fail(
    event: ClaimedIntegrationEvent,
    leaseId: string,
    errorCode: IntegrationEventSafeErrorCode,
    retryable: boolean,
    retryAfterAt: string | null = null
  ): Promise<MercadoLibreEventProcessingResult> {
    let outcome;
    try {
      outcome = await this.events.fail({
        eventId: event.id,
        leaseId,
        errorCode,
        errorSummary: safeErrorSummaries[errorCode],
        retryable,
        retryAfterAt
      });
    } catch {
      throw new MercadoLibreEventProcessingError('failure_persistence_failed');
    }
    if (outcome === 'ALREADY_PROCESSED') {
      return result('ALREADY_PROCESSED', event.processingAttempts);
    }
    if (outcome !== 'FAILED') {
      if (outcome === 'RETRY_SCHEDULED') {
        return result('FAILED_RETRYABLE', event.processingAttempts, errorCode);
      }
      if (outcome === 'RETRY_EXHAUSTED') {
        return result('FAILED_PERMANENT', event.processingAttempts, 'retry_exhausted');
      }
      return result('CLAIM_DENIED', event.processingAttempts);
    }
    return result('FAILED_PERMANENT', event.processingAttempts, errorCode);
  }
}

const safeErrorSummaries: Record<IntegrationEventSafeErrorCode, string> = {
  provider_rate_limited: 'Provider rate limit exhausted',
  provider_timeout: 'Provider request timed out',
  provider_unavailable: 'Provider temporarily unavailable',
  invalid_provider_response: 'Provider response is invalid',
  persistence_failure: 'Persistence operation failed',
  resource_not_found: 'Provider resource was not found',
  ambiguous_provider_timestamp: 'Provider freshness evidence is invalid',
  connection_binding_invalid: 'Connection binding is not processable',
  retry_exhausted: 'Retry attempts exhausted'
};

function result(
  outcome: MercadoLibreEventProcessingOutcome,
  processingAttempts: number | null = null,
  safeErrorCode: IntegrationEventSafeErrorCode | null = null
): MercadoLibreEventProcessingResult {
  return { outcome, processingAttempts, safeErrorCode };
}

function providerFailure(error: unknown): {
  code: IntegrationEventSafeErrorCode;
  retryable: boolean;
  retryAfterMilliseconds: number | null;
} {
  if (!(error instanceof MercadoLibreListingsError)) {
    return { code: 'provider_unavailable', retryable: true, retryAfterMilliseconds: null };
  }
  return {
    ...listingFailure({
      externalListingId: 'redacted',
      kind: error.kind,
      retryable: error.retryable,
      status: error.status
    }),
    retryAfterMilliseconds: error.retryAfterMilliseconds
  };
}

function listingFailure(failure: MercadoLibreListingFailure): {
  code: IntegrationEventSafeErrorCode;
  retryable: boolean;
  retryAfterMilliseconds: null;
} {
  if (failure.status === 404) {
    return { code: 'resource_not_found', retryable: false, retryAfterMilliseconds: null };
  }
  if (failure.kind === 'provider_rate_limited') {
    return { code: 'provider_rate_limited', retryable: true, retryAfterMilliseconds: null };
  }
  if (failure.kind === 'provider_timeout') {
    return { code: 'provider_timeout', retryable: true, retryAfterMilliseconds: null };
  }
  if (failure.kind === 'provider_server_error' || failure.kind === 'provider_network_error') {
    return { code: 'provider_unavailable', retryable: true, retryAfterMilliseconds: null };
  }
  return { code: 'invalid_provider_response', retryable: false, retryAfterMilliseconds: null };
}

function credentialFailure(error: unknown): {
  code: IntegrationEventSafeErrorCode;
  retryable: boolean;
} {
  if (!(error instanceof MercadoLibreCredentialError)) {
    return { code: 'provider_unavailable', retryable: true };
  }
  if (error.code === 'PROVIDER_TIMEOUT') {
    return { code: 'provider_timeout', retryable: true };
  }
  const permanent = new Set([
    'CONFIGURATION_ERROR',
    'CREDENTIAL_DECRYPT_FAILED',
    'CREDENTIALS_NOT_FOUND',
    'PROVIDER_INVALID_REFRESH_TOKEN',
    'PROVIDER_RESPONSE_INVALID',
    'CREDENTIAL_ENCRYPTION_FAILED'
  ]);
  return permanent.has(error.code)
    ? { code: 'invalid_provider_response', retryable: false }
    : { code: 'provider_unavailable', retryable: true };
}
