import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  CredentialRefreshClaim,
  DecryptedCredentials
} from '@/infrastructure/database/oauth-foundations';
import { OAuthFoundationRepository } from '@/infrastructure/database/oauth-foundations';
import { MercadoLibreOAuthClient, MercadoLibreProviderError } from './client';

const EXPIRY_SAFETY_WINDOW_MS = 120_000;

export class MercadoLibreCredentialError extends Error {
  constructor(
    public readonly kind:
      | 'credentials_not_found'
      | 'refresh_in_progress'
      | 'credential_refresh_conflict'
      | 'token_refresh_failed'
  ) {
    super(kind);
    this.name = 'MercadoLibreCredentialError';
  }
}

export interface MercadoLibreCredentialStore {
  readDecryptedCredentials(
    organizationId: string,
    connectionId: string
  ): Promise<DecryptedCredentials | null>;
  claimCredentialRefresh(input: {
    organizationId: string;
    connectionId: string;
    expectedVersion: number;
    refreshBefore: string;
    leaseId: string;
  }): Promise<CredentialRefreshClaim>;
  completeCredentialRefresh(input: {
    organizationId: string;
    connectionId: string;
    expectedVersion: number;
    leaseId: string;
    credentials: DecryptedCredentials;
  }): Promise<boolean>;
  releaseCredentialRefresh(input: {
    organizationId: string;
    connectionId: string;
    leaseId: string;
  }): Promise<boolean>;
}

export class MercadoLibreCredentialService {
  constructor(
    private readonly secrets: MercadoLibreCredentialStore = new OAuthFoundationRepository(),
    private readonly oauth = new MercadoLibreOAuthClient(),
    private readonly now: () => Date = () => new Date(),
    private readonly newLeaseId: () => string = randomUUID
  ) {}

  async getValidAccessToken(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<string> {
    const parsed = z
      .object({ organizationId: z.string().trim().min(1).max(255), connectionId: z.uuid() })
      .strict()
      .parse(input);
    const refreshBefore = new Date(this.now().getTime() + EXPIRY_SAFETY_WINDOW_MS);
    const current = await this.requireCredentials(parsed.organizationId, parsed.connectionId);
    if (isCurrent(current, refreshBefore)) return current.accessToken;

    const leaseId = this.newLeaseId();
    const claim = await this.secrets.claimCredentialRefresh({
      organizationId: parsed.organizationId,
      connectionId: parsed.connectionId,
      expectedVersion: current.credentialVersion,
      refreshBefore: refreshBefore.toISOString(),
      leaseId
    });

    if (claim.outcome === 'not_found')
      throw new MercadoLibreCredentialError('credentials_not_found');
    if (claim.outcome === 'busy') {
      const refreshedByPeer = await this.waitForPeerRefresh(
        parsed.organizationId,
        parsed.connectionId,
        refreshBefore
      );
      if (refreshedByPeer) return refreshedByPeer.accessToken;
      throw new MercadoLibreCredentialError('refresh_in_progress');
    }
    if (claim.outcome === 'already_refreshed') {
      const latest = await this.requireCredentials(parsed.organizationId, parsed.connectionId);
      if (isCurrent(latest, refreshBefore)) return latest.accessToken;
      throw new MercadoLibreCredentialError('credential_refresh_conflict');
    }

    let completed = false;
    try {
      // A different process may have persisted a token immediately before our short claim transaction.
      const afterClaim = await this.requireCredentials(parsed.organizationId, parsed.connectionId);
      if (isCurrent(afterClaim, refreshBefore)) return afterClaim.accessToken;

      let refreshed;
      try {
        refreshed = await this.oauth.refreshAccessToken(afterClaim.refreshToken);
      } catch {
        throw new MercadoLibreCredentialError('token_refresh_failed');
      }
      const expiresAt = new Date(this.now().getTime() + refreshed.expiresInSeconds * 1000);
      const credentials: DecryptedCredentials = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken!,
        accessTokenExpiresAt: expiresAt.toISOString(),
        tokenMetadata: refreshedTokenMetadata(afterClaim.tokenMetadata, refreshed),
        credentialVersion: afterClaim.credentialVersion + 1
      };
      completed = await this.secrets.completeCredentialRefresh({
        organizationId: parsed.organizationId,
        connectionId: parsed.connectionId,
        expectedVersion: afterClaim.credentialVersion,
        leaseId,
        credentials
      });
      if (completed) return credentials.accessToken;

      const latest = await this.requireCredentials(parsed.organizationId, parsed.connectionId);
      if (isCurrent(latest, refreshBefore)) return latest.accessToken;
      throw new MercadoLibreCredentialError('credential_refresh_conflict');
    } catch (error) {
      if (error instanceof MercadoLibreCredentialError) throw error;
      if (error instanceof MercadoLibreProviderError) {
        throw new MercadoLibreCredentialError('token_refresh_failed');
      }
      throw error;
    } finally {
      if (!completed) {
        await this.secrets.releaseCredentialRefresh({
          organizationId: parsed.organizationId,
          connectionId: parsed.connectionId,
          leaseId
        });
      }
    }
  }

  private async requireCredentials(
    organizationId: string,
    connectionId: string
  ): Promise<DecryptedCredentials> {
    const credentials = await this.secrets.readDecryptedCredentials(organizationId, connectionId);
    if (!credentials) throw new MercadoLibreCredentialError('credentials_not_found');
    return credentials;
  }

  private async waitForPeerRefresh(
    organizationId: string,
    connectionId: string,
    refreshBefore: Date
  ): Promise<DecryptedCredentials | null> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const latest = await this.requireCredentials(organizationId, connectionId);
      if (isCurrent(latest, refreshBefore)) return latest;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }
}

function isCurrent(credentials: DecryptedCredentials, refreshBefore: Date): boolean {
  return Date.parse(credentials.accessTokenExpiresAt) > refreshBefore.getTime();
}

function refreshedTokenMetadata(
  previous: Record<string, string>,
  token: { tokenType: string; scope?: string; userId?: string }
): Record<string, string> {
  return {
    ...previous,
    token_type: token.tokenType,
    ...(token.scope ? { scope: token.scope } : {}),
    ...(token.userId ? { user_id: token.userId } : {})
  };
}

export { EXPIRY_SAFETY_WINDOW_MS };
