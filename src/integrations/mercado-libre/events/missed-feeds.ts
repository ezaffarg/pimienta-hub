import 'server-only';

import { z } from 'zod';
import { ConnectionRepository } from '@/infrastructure/database/repositories';
import {
  MercadoLibreCredentialError,
  getMercadoLibreOAuthConfig,
  MercadoLibreCredentialService,
  MercadoLibreOAuthClient,
  type CasCompleteFailureCode,
  type CredentialRefreshDiagnostics,
  type CredentialRefreshFailureStage
} from '../auth';
import { MercadoLibreEventIntakeService } from './intake';

const PAGE_LIMIT = 10;
const MAX_PAGES = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
const identitySchema = z.union([
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(String),
  z
    .string()
    .trim()
    .regex(/^\d{1,255}$/)
]);
const siteIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/);
const missedFeedMessageSchema = z
  .object({
    _id: z.string().trim().min(1).max(255).optional(),
    resource: z
      .string()
      .trim()
      .regex(/^\/items\/[A-Z]{3}\d{1,32}$/),
    user_id: identitySchema,
    topic: z.literal('items'),
    application_id: identitySchema,
    attempts: z.number().int().positive(),
    sent: z.iso.datetime({ offset: true }),
    received: z.iso.datetime({ offset: true })
  })
  .passthrough();
const responseSchema = z
  .object({ messages: z.array(missedFeedMessageSchema).max(PAGE_LIMIT) })
  .passthrough();

export interface MercadoLibreMissedFeedMessage {
  externalEventId?: string;
  resource: string;
  user_id: string;
  topic: 'items';
  application_id: string;
  attempts: number;
  sent: string;
  received: string;
}

export const missedFeedFailureStages = [
  'connection_resolution',
  'credential_resolution',
  'identity_request',
  'identity_validation',
  'configuration',
  'missed_feed_request',
  'missed_feed_response',
  'missed_feed_pagination',
  'event_intake',
  'other'
] as const;

export type MercadoLibreMissedFeedFailureStage = (typeof missedFeedFailureStages)[number];

export const missedFeedResponseSubdiagnostics = [
  'RESPONSE_JSON',
  'RESPONSE_SCHEMA',
  'RESPONSE_BINDING'
] as const;

export type MercadoLibreMissedFeedResponseSubdiagnostic =
  (typeof missedFeedResponseSubdiagnostics)[number];

export const missedFeedResponseSchemaCategories = [
  'RESPONSE_SCHEMA_RESOURCE',
  'RESPONSE_SCHEMA_USER_ID',
  'RESPONSE_SCHEMA_TOPIC',
  'RESPONSE_SCHEMA_APPLICATION_ID',
  'RESPONSE_SCHEMA_ATTEMPTS',
  'RESPONSE_SCHEMA_SENT',
  'RESPONSE_SCHEMA_RECEIVED',
  'RESPONSE_SCHEMA_MESSAGES',
  'RESPONSE_SCHEMA_TOP_LEVEL',
  'RESPONSE_SCHEMA_OTHER'
] as const;

export type MercadoLibreMissedFeedResponseSchemaCategory =
  (typeof missedFeedResponseSchemaCategories)[number];

export const missedFeedMessagesDetails = [
  'MESSAGES_MISSING',
  'MESSAGES_NULL',
  'MESSAGES_WRONG_TYPE',
  'MESSAGES_LENGTH',
  'MESSAGES_ELEMENT',
  'MESSAGES_OTHER'
] as const;

export type MercadoLibreMissedFeedMessagesDetail = (typeof missedFeedMessagesDetails)[number];

export class MercadoLibreMissedFeedsError extends Error {
  constructor(
    public readonly code:
      | 'configuration_invalid'
      | 'connection_not_found'
      | 'connection_binding_invalid'
      | 'credential_failed'
      | 'identity_lookup_failed'
      | 'provider_rate_limited'
      | 'provider_unavailable'
      | 'provider_timeout'
      | 'provider_response_invalid'
      | 'pagination_loop'
      | 'intake_failed',
    observability: {
      failureStage?: MercadoLibreMissedFeedFailureStage;
      providerCallsAttempted?: number;
      providerCallsSucceeded?: number;
      providerCallSucceeded?: boolean;
      credentialRefreshFailureStage?: CredentialRefreshFailureStage | null;
      credentialRefreshCasFailure?: CasCompleteFailureCode | null;
      credentialRefreshCallsAttempted?: number;
      credentialRefreshCallsSucceeded?: number;
      responseSubdiagnostic?: MercadoLibreMissedFeedResponseSubdiagnostic | null;
      responseSchemaCategory?: MercadoLibreMissedFeedResponseSchemaCategory | null;
      responseMessagesDetail?: MercadoLibreMissedFeedMessagesDetail | null;
    } = {}
  ) {
    super(code);
    this.name = 'MercadoLibreMissedFeedsError';
    this.failureStage = observability.failureStage ?? 'other';
    this.providerCallsAttempted = observability.providerCallsAttempted ?? 0;
    this.providerCallsSucceeded = observability.providerCallsSucceeded ?? 0;
    this.providerCallSucceeded = observability.providerCallSucceeded ?? false;
    this.credentialRefreshFailureStage = observability.credentialRefreshFailureStage ?? null;
    this.credentialRefreshCasFailure = observability.credentialRefreshCasFailure ?? null;
    this.credentialRefreshCallsAttempted = observability.credentialRefreshCallsAttempted ?? 0;
    this.credentialRefreshCallsSucceeded = observability.credentialRefreshCallsSucceeded ?? 0;
    this.responseSubdiagnostic = observability.responseSubdiagnostic ?? null;
    this.responseSchemaCategory = observability.responseSchemaCategory ?? null;
    this.responseMessagesDetail = observability.responseMessagesDetail ?? null;
  }

  readonly failureStage: MercadoLibreMissedFeedFailureStage;
  readonly providerCallsAttempted: number;
  readonly providerCallsSucceeded: number;
  readonly providerCallSucceeded: boolean;
  readonly credentialRefreshFailureStage: CredentialRefreshFailureStage | null;
  readonly credentialRefreshCasFailure: CasCompleteFailureCode | null;
  readonly credentialRefreshCallsAttempted: number;
  readonly credentialRefreshCallsSucceeded: number;
  readonly responseSubdiagnostic: MercadoLibreMissedFeedResponseSubdiagnostic | null;
  readonly responseSchemaCategory: MercadoLibreMissedFeedResponseSchemaCategory | null;
  readonly responseMessagesDetail: MercadoLibreMissedFeedMessagesDetail | null;
}

export class MercadoLibreMissedFeedsClient {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly apiBaseUrl = 'https://api.mercadolibre.com',
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS
  ) {}

  async getItemsPage(input: {
    accessToken: string;
    applicationId: string;
    siteId: string;
    offset: number;
  }): Promise<readonly MercadoLibreMissedFeedMessage[]> {
    const applicationId = identitySchema.parse(input.applicationId);
    const siteId = siteIdSchema.parse(input.siteId);
    const offset = z.number().int().nonnegative().parse(input.offset);
    const url = new URL('/missed_feeds', this.apiBaseUrl);
    url.searchParams.set('app_id', applicationId);
    url.searchParams.set('topic', 'items');
    url.searchParams.set('site_id', siteId);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(PAGE_LIMIT));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${input.accessToken}`, accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store'
      });
    } catch (error) {
      throw new MercadoLibreMissedFeedsError(
        controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
          ? 'provider_timeout'
          : 'provider_unavailable'
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) throw new MercadoLibreMissedFeedsError('provider_rate_limited');
    if (response.status >= 500) throw new MercadoLibreMissedFeedsError('provider_unavailable');
    if (!response.ok) throw new MercadoLibreMissedFeedsError('provider_response_invalid');

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MercadoLibreMissedFeedsError('provider_response_invalid', {
        providerCallSucceeded: true,
        responseSubdiagnostic: 'RESPONSE_JSON'
      });
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      const classification = classifyResponseSchemaError(parsed.error, payload);
      throw new MercadoLibreMissedFeedsError('provider_response_invalid', {
        providerCallSucceeded: true,
        responseSubdiagnostic: 'RESPONSE_SCHEMA',
        ...classification
      });
    }
    return parsed.data.messages.map((message) => {
      const { _id: externalEventId } = message;
      return {
        ...(externalEventId === undefined ? {} : { externalEventId }),
        resource: message.resource,
        user_id: message.user_id,
        topic: message.topic,
        application_id: message.application_id,
        attempts: message.attempts,
        sent: message.sent,
        received: message.received
      };
    });
  }
}

export interface MercadoLibreMissedFeedRecoveryResult {
  pages: number;
  accepted: number;
  duplicates: number;
  exhausted: boolean;
  nextOffset: number | null;
  providerCallsAttempted: number;
  providerCallsSucceeded: number;
  credentialRefreshFailureStage: CredentialRefreshFailureStage | null;
  credentialRefreshCasFailure: CasCompleteFailureCode | null;
  credentialRefreshCallsAttempted: number;
  credentialRefreshCallsSucceeded: number;
}

export interface MercadoLibreMissedFeedRecoveryDependencies {
  connections?: Pick<ConnectionRepository, 'getById'>;
  credentials?: Pick<MercadoLibreCredentialService, 'getValidAccessToken'>;
  identity?: Pick<MercadoLibreOAuthClient, 'getCurrentUser'>;
  feeds?: Pick<MercadoLibreMissedFeedsClient, 'getItemsPage'>;
  intake?: Pick<MercadoLibreEventIntakeService, 'intakeItemsNotification'>;
  applicationId?: () => string;
}

export class MercadoLibreMissedFeedRecoveryService {
  constructor(private readonly dependencies: MercadoLibreMissedFeedRecoveryDependencies = {}) {}

  async recoverItems(input: {
    organizationId: string;
    connectionId: string;
    offset?: number;
    maxPages?: number;
  }): Promise<MercadoLibreMissedFeedRecoveryResult> {
    const scope = z
      .object({
        organizationId: z.string().trim().min(1).max(255),
        connectionId: z.uuid(),
        offset: z.number().int().nonnegative().optional(),
        maxPages: z.number().int().min(1).max(MAX_PAGES).optional()
      })
      .strict()
      .parse(input);
    let providerCallsAttempted = 0;
    let providerCallsSucceeded = 0;
    const connection = await this.connection(scope.organizationId, scope.connectionId).catch(
      (error) => {
        throw observedFailure(error, 'connection_resolution', 0, 0);
      }
    );
    const credentials = this.dependencies.credentials ?? new MercadoLibreCredentialService();
    const credentialScope = {
      organizationId: scope.organizationId,
      connectionId: scope.connectionId
    };
    let credentialRefreshDiagnostics = emptyCredentialRefreshDiagnostics();
    let accessToken: string;
    try {
      accessToken = await credentials.getValidAccessToken(credentialScope, (diagnostics) => {
        credentialRefreshDiagnostics = diagnostics;
      });
    } catch (error) {
      credentialRefreshDiagnostics = credentialDiagnosticsFrom(error, credentialRefreshDiagnostics);
      throw observedFailure(
        new MercadoLibreMissedFeedsError('credential_failed'),
        'credential_resolution',
        0,
        0,
        credentialRefreshDiagnostics
      );
    }
    const failure = (
      error: unknown,
      failureStage: MercadoLibreMissedFeedFailureStage,
      attempted: number,
      succeeded: number
    ) => observedFailure(error, failureStage, attempted, succeeded, credentialRefreshDiagnostics);
    const identity = this.dependencies.identity ?? new MercadoLibreOAuthClient();
    let currentUser;
    providerCallsAttempted += 1;
    try {
      currentUser = await identity.getCurrentUser(accessToken);
      providerCallsSucceeded += 1;
    } catch (error) {
      throw failure(
        error instanceof MercadoLibreMissedFeedsError
          ? error
          : new MercadoLibreMissedFeedsError('identity_lookup_failed'),
        'identity_request',
        providerCallsAttempted,
        providerCallsSucceeded
      );
    }
    if (currentUser.externalAccountId !== connection.externalAccountId) {
      throw failure(
        new MercadoLibreMissedFeedsError('connection_binding_invalid'),
        'identity_validation',
        providerCallsAttempted,
        providerCallsSucceeded
      );
    }
    let siteId;
    try {
      siteId = siteIdSchema.parse(currentUser.siteId);
    } catch {
      throw failure(
        new MercadoLibreMissedFeedsError('identity_lookup_failed'),
        'identity_validation',
        providerCallsAttempted,
        providerCallsSucceeded
      );
    }
    let applicationId;
    try {
      applicationId = identitySchema.parse(
        (this.dependencies.applicationId ?? (() => getMercadoLibreOAuthConfig().clientId))()
      );
    } catch {
      throw failure(
        new MercadoLibreMissedFeedsError('configuration_invalid'),
        'configuration',
        providerCallsAttempted,
        providerCallsSucceeded
      );
    }

    const feeds = this.dependencies.feeds ?? new MercadoLibreMissedFeedsClient();
    const intake = this.dependencies.intake ?? new MercadoLibreEventIntakeService();
    const pageSignatures = new Set<string>();
    let accepted = 0;
    let duplicates = 0;
    const startOffset = scope.offset ?? 0;
    const maxPages = scope.maxPages ?? MAX_PAGES;

    for (let page = 0; page < maxPages; page += 1) {
      let messages: readonly MercadoLibreMissedFeedMessage[];
      providerCallsAttempted += 1;
      try {
        messages = await feeds.getItemsPage({
          accessToken,
          applicationId,
          siteId,
          offset: startOffset + page * PAGE_LIMIT
        });
        providerCallsSucceeded += 1;
      } catch (error) {
        const normalized =
          error instanceof MercadoLibreMissedFeedsError
            ? error
            : new MercadoLibreMissedFeedsError('provider_unavailable');
        if (normalized.providerCallSucceeded) providerCallsSucceeded += 1;
        throw failure(
          normalized,
          normalized.providerCallSucceeded ? 'missed_feed_response' : 'missed_feed_request',
          providerCallsAttempted,
          providerCallsSucceeded
        );
      }
      const signature = messages.map(messageSignature).join('|');
      if (messages.length > 0 && pageSignatures.has(signature)) {
        throw failure(
          new MercadoLibreMissedFeedsError('pagination_loop'),
          'missed_feed_pagination',
          providerCallsAttempted,
          providerCallsSucceeded
        );
      }
      pageSignatures.add(signature);
      try {
        this.assertPageBinding(messages, connection.externalAccountId!, applicationId, siteId);
      } catch (error) {
        throw failure(
          error,
          'missed_feed_response',
          providerCallsAttempted,
          providerCallsSucceeded
        );
      }

      for (const message of messages) {
        try {
          const { externalEventId: _id, ...notification } = message;
          const result = await intake.intakeItemsNotification({
            ...(_id === undefined ? {} : { _id }),
            ...notification
          });
          if (result.outcome === 'ACCEPTED') accepted += 1;
          else duplicates += 1;
        } catch {
          throw failure(
            new MercadoLibreMissedFeedsError('intake_failed'),
            'event_intake',
            providerCallsAttempted,
            providerCallsSucceeded
          );
        }
      }
      if (messages.length < PAGE_LIMIT) {
        return {
          pages: page + 1,
          accepted,
          duplicates,
          exhausted: true,
          nextOffset: null,
          providerCallsAttempted,
          providerCallsSucceeded,
          credentialRefreshFailureStage: credentialRefreshDiagnostics.failureStage,
          credentialRefreshCasFailure: credentialRefreshDiagnostics.casFailure,
          credentialRefreshCallsAttempted: credentialRefreshDiagnostics.providerCallsAttempted,
          credentialRefreshCallsSucceeded: credentialRefreshDiagnostics.providerCallsSucceeded
        };
      }
    }
    return {
      pages: maxPages,
      accepted,
      duplicates,
      exhausted: false,
      nextOffset: startOffset + maxPages * PAGE_LIMIT,
      providerCallsAttempted,
      providerCallsSucceeded,
      credentialRefreshFailureStage: credentialRefreshDiagnostics.failureStage,
      credentialRefreshCasFailure: credentialRefreshDiagnostics.casFailure,
      credentialRefreshCallsAttempted: credentialRefreshDiagnostics.providerCallsAttempted,
      credentialRefreshCallsSucceeded: credentialRefreshDiagnostics.providerCallsSucceeded
    };
  }

  private async connection(organizationId: string, connectionId: string) {
    const connections = this.dependencies.connections ?? new ConnectionRepository();
    let connection;
    try {
      connection = await connections.getById(organizationId, connectionId);
    } catch {
      throw new MercadoLibreMissedFeedsError('connection_not_found');
    }
    if (!connection) throw new MercadoLibreMissedFeedsError('connection_not_found');
    if (
      connection.organizationId !== organizationId ||
      connection.id !== connectionId ||
      connection.provider !== 'mercado-libre' ||
      connection.status !== 'active' ||
      !connection.externalAccountId
    ) {
      throw new MercadoLibreMissedFeedsError('connection_binding_invalid');
    }
    return connection;
  }

  private assertPageBinding(
    messages: readonly MercadoLibreMissedFeedMessage[],
    externalAccountId: string,
    applicationId: string,
    siteId: string
  ): void {
    if (
      messages.some(
        (message) =>
          message.user_id !== externalAccountId ||
          message.application_id !== applicationId ||
          message.resource.slice('/items/'.length, '/items/'.length + 3) !== siteId
      )
    ) {
      throw new MercadoLibreMissedFeedsError('connection_binding_invalid', {
        responseSubdiagnostic: 'RESPONSE_BINDING'
      });
    }
  }
}

function messageSignature(message: MercadoLibreMissedFeedMessage): string {
  return (
    message.externalEventId ??
    [
      message.resource,
      message.user_id,
      message.application_id,
      message.sent,
      message.received
    ].join('\u001f')
  );
}

function observedFailure(
  error: unknown,
  failureStage: MercadoLibreMissedFeedFailureStage,
  providerCallsAttempted: number,
  providerCallsSucceeded: number,
  credentialRefreshDiagnostics = emptyCredentialRefreshDiagnostics()
): MercadoLibreMissedFeedsError {
  const code = error instanceof MercadoLibreMissedFeedsError ? error.code : 'provider_unavailable';
  const responseSubdiagnostic =
    error instanceof MercadoLibreMissedFeedsError ? error.responseSubdiagnostic : null;
  const responseSchemaCategory =
    error instanceof MercadoLibreMissedFeedsError ? error.responseSchemaCategory : null;
  const responseMessagesDetail =
    error instanceof MercadoLibreMissedFeedsError ? error.responseMessagesDetail : null;
  if (failureStage === 'missed_feed_response' && responseSubdiagnostic !== null) {
    process.stderr.write(
      `${JSON.stringify({
        component: 'meli-missed-feed',
        failureStage,
        subdiagnostic: responseSubdiagnostic,
        ...(responseSubdiagnostic === 'RESPONSE_SCHEMA' && responseSchemaCategory !== null
          ? { schemaCategory: responseSchemaCategory }
          : {}),
        ...(responseSchemaCategory === 'RESPONSE_SCHEMA_MESSAGES' && responseMessagesDetail !== null
          ? { messagesDetail: responseMessagesDetail }
          : {})
      })}\n`
    );
  }
  return new MercadoLibreMissedFeedsError(code, {
    failureStage,
    providerCallsAttempted,
    providerCallsSucceeded,
    credentialRefreshFailureStage: credentialRefreshDiagnostics.failureStage,
    credentialRefreshCasFailure: credentialRefreshDiagnostics.casFailure,
    credentialRefreshCallsAttempted: credentialRefreshDiagnostics.providerCallsAttempted,
    credentialRefreshCallsSucceeded: credentialRefreshDiagnostics.providerCallsSucceeded,
    responseSubdiagnostic,
    responseSchemaCategory,
    responseMessagesDetail
  });
}

interface ResponseSchemaIssueMetadata {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly expected?: unknown;
  readonly origin?: unknown;
}

function classifyResponseSchemaError(
  error: { issues: readonly ResponseSchemaIssueMetadata[] },
  payload: unknown
): {
  responseSchemaCategory: MercadoLibreMissedFeedResponseSchemaCategory;
  responseMessagesDetail: MercadoLibreMissedFeedMessagesDetail | null;
} {
  const categories = new Set(error.issues.map((issue) => schemaCategoryForPath(issue.path)));
  const responseSchemaCategory =
    missedFeedResponseSchemaCategories.find((category) => categories.has(category)) ??
    'RESPONSE_SCHEMA_OTHER';
  return {
    responseSchemaCategory,
    responseMessagesDetail:
      responseSchemaCategory === 'RESPONSE_SCHEMA_MESSAGES'
        ? classifyMessagesDetail(error.issues, payload)
        : null
  };
}

function classifyMessagesDetail(
  issues: readonly ResponseSchemaIssueMetadata[],
  payload: unknown
): MercadoLibreMissedFeedMessagesDetail {
  const messageIssues = issues.filter(
    (issue) => schemaCategoryForPath(issue.path) === 'RESPONSE_SCHEMA_MESSAGES'
  );
  if (
    messageIssues.some(
      (issue) =>
        issue.path.length === 1 && issue.code === 'invalid_type' && issue.expected === 'array'
    )
  ) {
    return messagesTypeDetail(payload);
  }
  const details = new Set(messageIssues.map(messagesDetailForIssue));
  return missedFeedMessagesDetails.find((detail) => details.has(detail)) ?? 'MESSAGES_OTHER';
}

function messagesTypeDetail(payload: unknown): MercadoLibreMissedFeedMessagesDetail {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'MESSAGES_OTHER';
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'messages')) return 'MESSAGES_MISSING';
  const messages = (payload as Record<string, unknown>).messages;
  if (messages === null) return 'MESSAGES_NULL';
  return Array.isArray(messages) ? 'MESSAGES_OTHER' : 'MESSAGES_WRONG_TYPE';
}

function messagesDetailForIssue(
  issue: ResponseSchemaIssueMetadata
): MercadoLibreMissedFeedMessagesDetail {
  if (issue.path[0] !== 'messages') return 'MESSAGES_OTHER';
  if (issue.path.length === 2 && typeof issue.path[1] === 'number') return 'MESSAGES_ELEMENT';
  if (issue.path.length !== 1) return 'MESSAGES_OTHER';
  if (issue.code === 'too_big' && issue.origin === 'array') return 'MESSAGES_LENGTH';
  return 'MESSAGES_OTHER';
}

function schemaCategoryForPath(
  path: readonly PropertyKey[]
): MercadoLibreMissedFeedResponseSchemaCategory {
  if (path[0] !== 'messages') return 'RESPONSE_SCHEMA_TOP_LEVEL';
  if (path.length < 3) return 'RESPONSE_SCHEMA_MESSAGES';
  switch (path[2]) {
    case 'resource':
      return 'RESPONSE_SCHEMA_RESOURCE';
    case 'user_id':
      return 'RESPONSE_SCHEMA_USER_ID';
    case 'topic':
      return 'RESPONSE_SCHEMA_TOPIC';
    case 'application_id':
      return 'RESPONSE_SCHEMA_APPLICATION_ID';
    case 'attempts':
      return 'RESPONSE_SCHEMA_ATTEMPTS';
    case 'sent':
      return 'RESPONSE_SCHEMA_SENT';
    case 'received':
      return 'RESPONSE_SCHEMA_RECEIVED';
    default:
      return 'RESPONSE_SCHEMA_OTHER';
  }
}

function emptyCredentialRefreshDiagnostics(): CredentialRefreshDiagnostics {
  return {
    failureStage: null,
    casFailure: null,
    providerCallsAttempted: 0,
    providerCallsSucceeded: 0
  };
}

function credentialDiagnosticsFrom(
  error: unknown,
  observed: CredentialRefreshDiagnostics
): CredentialRefreshDiagnostics {
  if (!(error instanceof MercadoLibreCredentialError)) return observed;
  return {
    failureStage: error.details.refreshFailureStage ?? observed.failureStage,
    casFailure: error.details.casFailure ?? observed.casFailure,
    providerCallsAttempted: error.details.refreshCallsAttempted ?? observed.providerCallsAttempted,
    providerCallsSucceeded: error.details.refreshCallsSucceeded ?? observed.providerCallsSucceeded
  };
}
