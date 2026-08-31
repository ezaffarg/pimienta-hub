import 'server-only';

import { z } from 'zod';
import { ConnectionRepository } from '@/infrastructure/database/repositories';
import {
  getMercadoLibreOAuthConfig,
  MercadoLibreCredentialService,
  MercadoLibreOAuthClient
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
    _id: z.string().trim().min(1).max(255),
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
  externalEventId: string;
  resource: string;
  user_id: string;
  topic: 'items';
  application_id: string;
  attempts: number;
  sent: string;
  received: string;
}

export class MercadoLibreMissedFeedsError extends Error {
  constructor(
    public readonly code:
      | 'configuration_invalid'
      | 'connection_not_found'
      | 'connection_binding_invalid'
      | 'identity_lookup_failed'
      | 'provider_rate_limited'
      | 'provider_unavailable'
      | 'provider_timeout'
      | 'provider_response_invalid'
      | 'pagination_loop'
      | 'intake_failed'
  ) {
    super(code);
    this.name = 'MercadoLibreMissedFeedsError';
  }
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
      throw new MercadoLibreMissedFeedsError('provider_response_invalid');
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) throw new MercadoLibreMissedFeedsError('provider_response_invalid');
    return parsed.data.messages.map((message) => {
      const { _id: externalEventId } = message;
      return {
        externalEventId,
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
    const connection = await this.connection(scope.organizationId, scope.connectionId);
    const credentials = this.dependencies.credentials ?? new MercadoLibreCredentialService();
    const accessToken = await credentials.getValidAccessToken(scope);
    const identity = this.dependencies.identity ?? new MercadoLibreOAuthClient();
    let currentUser;
    try {
      currentUser = await identity.getCurrentUser(accessToken);
    } catch {
      throw new MercadoLibreMissedFeedsError('identity_lookup_failed');
    }
    if (currentUser.externalAccountId !== connection.externalAccountId) {
      throw new MercadoLibreMissedFeedsError('connection_binding_invalid');
    }
    let siteId;
    try {
      siteId = siteIdSchema.parse(currentUser.siteId);
    } catch {
      throw new MercadoLibreMissedFeedsError('identity_lookup_failed');
    }
    let applicationId;
    try {
      applicationId = identitySchema.parse(
        (this.dependencies.applicationId ?? (() => getMercadoLibreOAuthConfig().clientId))()
      );
    } catch {
      throw new MercadoLibreMissedFeedsError('configuration_invalid');
    }

    const feeds = this.dependencies.feeds ?? new MercadoLibreMissedFeedsClient();
    const intake = this.dependencies.intake ?? new MercadoLibreEventIntakeService();
    const pageSignatures = new Set<string>();
    let accepted = 0;
    let duplicates = 0;
    const startOffset = scope.offset ?? 0;
    const maxPages = scope.maxPages ?? MAX_PAGES;

    for (let page = 0; page < maxPages; page += 1) {
      const messages = await feeds.getItemsPage({
        accessToken,
        applicationId,
        siteId,
        offset: startOffset + page * PAGE_LIMIT
      });
      const signature = messages.map((message) => message.externalEventId).join('|');
      if (messages.length > 0 && pageSignatures.has(signature)) {
        throw new MercadoLibreMissedFeedsError('pagination_loop');
      }
      pageSignatures.add(signature);
      this.assertPageBinding(messages, connection.externalAccountId!, applicationId, siteId);

      for (const message of messages) {
        try {
          const { externalEventId: _id, ...notification } = message;
          const result = await intake.intakeItemsNotification({ _id, ...notification });
          if (result.outcome === 'ACCEPTED') accepted += 1;
          else duplicates += 1;
        } catch {
          throw new MercadoLibreMissedFeedsError('intake_failed');
        }
      }
      if (messages.length < PAGE_LIMIT) {
        return {
          pages: page + 1,
          accepted,
          duplicates,
          exhausted: true,
          nextOffset: null
        };
      }
    }
    return {
      pages: maxPages,
      accepted,
      duplicates,
      exhausted: false,
      nextOffset: startOffset + maxPages * PAGE_LIMIT
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
      throw new MercadoLibreMissedFeedsError('connection_binding_invalid');
    }
  }
}
