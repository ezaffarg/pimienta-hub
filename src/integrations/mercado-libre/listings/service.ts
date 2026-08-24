import 'server-only';

import { z } from 'zod';
import type { ExternalListingSummary, IntegrationPage } from '@/integrations/core';
import { OAuthFoundationRepository } from '@/infrastructure/database/oauth-foundations';
import { ConnectionRepository } from '@/infrastructure/database/repositories';
import { MercadoLibreListingsClient } from './client';

export class MercadoLibreListingsServiceError extends Error {
  constructor(
    public readonly kind:
      | 'connection_not_found'
      | 'connection_not_active'
      | 'connection_binding_invalid'
      | 'credentials_not_found'
      | 'access_token_expired'
  ) {
    super(kind);
    this.name = 'MercadoLibreListingsServiceError';
  }
}

export class MercadoLibreListingsService {
  constructor(
    private readonly connections = new ConnectionRepository(),
    private readonly oauth = new OAuthFoundationRepository(),
    private readonly listings = new MercadoLibreListingsClient()
  ) {}

  async listActiveConnectionListings(input: {
    organizationId: string;
    storeId: string;
    connectionId: string;
    limit?: number;
  }): Promise<IntegrationPage<ExternalListingSummary> & { total: number | null }> {
    const parsed = z
      .object({
        organizationId: z.string().trim().min(1).max(255),
        storeId: z.uuid(),
        connectionId: z.uuid(),
        limit: z.number().int().min(1).max(20).optional()
      })
      .strict()
      .parse(input);
    const connection = await this.connections.getById(parsed.organizationId, parsed.connectionId);
    if (!connection) throw new MercadoLibreListingsServiceError('connection_not_found');
    if (connection.status !== 'active') {
      throw new MercadoLibreListingsServiceError('connection_not_active');
    }
    if (
      connection.organizationId !== parsed.organizationId ||
      connection.storeId !== parsed.storeId ||
      connection.provider !== 'mercado-libre' ||
      !connection.externalAccountId
    ) {
      throw new MercadoLibreListingsServiceError('connection_binding_invalid');
    }

    const credentials = await this.oauth.readDecryptedCredentials(
      parsed.organizationId,
      parsed.connectionId
    );
    if (!credentials) throw new MercadoLibreListingsServiceError('credentials_not_found');
    if (Date.parse(credentials.accessTokenExpiresAt) <= Date.now()) {
      throw new MercadoLibreListingsServiceError('access_token_expired');
    }

    return this.listings.listSellerListings({
      accessToken: credentials.accessToken,
      sellerId: connection.externalAccountId,
      limit: parsed.limit ?? 20
    });
  }
}
