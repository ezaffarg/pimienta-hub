import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  CredentialRefreshCompleteFailureCode,
  CredentialRefreshClaim,
  CredentialRefreshState,
  DecryptedCredentials
} from '@/infrastructure/database/oauth-foundations';
import {
  CredentialRefreshCompleteError,
  OAuthFoundationRepository
} from '@/infrastructure/database/oauth-foundations';
import { SecretCipherError } from '@/lib/crypto/integration-secrets';
import { MercadoLibreOAuthClient, MercadoLibreProviderError } from './client';

const EXPIRY_SAFETY_WINDOW_MS = 120_000;

export class MercadoLibreCredentialError extends Error {
  constructor(
    public readonly code: RefreshErrorCode,
    public readonly stage: RefreshStage,
    public readonly details: RefreshErrorDetails = {}
  ) {
    super(code);
    this.name = 'MercadoLibreCredentialError';
  }

  get kind(): RefreshErrorCode {
    return this.code;
  }
}

export interface RefreshErrorDetails {
  httpStatus?: number;
  providerCode?: string;
  casFailure?: CasCompleteFailureCode;
  expectedVersion?: number;
  actualVersion?: number | null;
  leasePresent?: boolean;
  leaseMatches?: boolean;
}

export type CasCompleteFailureCode = CredentialRefreshCompleteFailureCode | 'CAS_REJECTED';

export type RefreshStage =
  | 'READ'
  | 'DECRYPT'
  | 'EXPIRY_CHECK'
  | 'CLAIM'
  | 'DOUBLE_CHECK'
  | 'PROVIDER_REQUEST'
  | 'PROVIDER_RESPONSE'
  | 'ENCRYPT'
  | 'CAS_COMPLETE'
  | 'RELEASE';

export type RefreshErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'CREDENTIAL_READ_FAILED'
  | 'CREDENTIAL_DECRYPT_FAILED'
  | 'CREDENTIALS_NOT_FOUND'
  | 'REFRESH_CLAIM_FAILED'
  | 'REFRESH_BUSY'
  | 'REFRESH_DOUBLE_CHECK_FAILED'
  | 'PROVIDER_NETWORK_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_HTTP_ERROR'
  | 'PROVIDER_INVALID_REFRESH_TOKEN'
  | 'PROVIDER_RESPONSE_INVALID'
  | 'CREDENTIAL_ENCRYPTION_FAILED'
  | 'REFRESH_COMPLETE_RPC_FAILED'
  | 'REFRESH_CAS_REJECTED'
  | 'REFRESH_RELEASE_FAILED'
  | 'REFRESH_UNKNOWN_ERROR';

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
  getCredentialRefreshState(input: {
    organizationId: string;
    connectionId: string;
    leaseId: string;
  }): Promise<CredentialRefreshState | null>;
  releaseCredentialRefresh(input: {
    organizationId: string;
    connectionId: string;
    leaseId: string;
  }): Promise<boolean>;
}

export class MercadoLibreCredentialService {
  constructor(
    private readonly secrets: MercadoLibreCredentialStore = new OAuthFoundationRepository(),
    private readonly oauth?: MercadoLibreOAuthClient,
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
    const current = await this.requireCredentials(
      parsed.organizationId,
      parsed.connectionId,
      'READ'
    );
    if (isCurrent(current, refreshBefore)) return current.accessToken;

    const leaseId = this.newLeaseId();
    let claim: CredentialRefreshClaim;
    try {
      claim = await this.secrets.claimCredentialRefresh({
        organizationId: parsed.organizationId,
        connectionId: parsed.connectionId,
        expectedVersion: current.credentialVersion,
        refreshBefore: refreshBefore.toISOString(),
        leaseId
      });
    } catch {
      throw new MercadoLibreCredentialError('REFRESH_CLAIM_FAILED', 'CLAIM');
    }

    if (claim.outcome === 'not_found')
      throw new MercadoLibreCredentialError('CREDENTIALS_NOT_FOUND', 'CLAIM');
    if (claim.outcome === 'busy') {
      const refreshedByPeer = await this.waitForPeerRefresh(
        parsed.organizationId,
        parsed.connectionId,
        refreshBefore
      );
      if (refreshedByPeer) return refreshedByPeer.accessToken;
      throw new MercadoLibreCredentialError('REFRESH_BUSY', 'CLAIM');
    }
    if (claim.outcome === 'already_refreshed') {
      const latest = await this.requireCredentials(
        parsed.organizationId,
        parsed.connectionId,
        'DOUBLE_CHECK'
      );
      if (isCurrent(latest, refreshBefore)) return latest.accessToken;
      throw new MercadoLibreCredentialError('REFRESH_DOUBLE_CHECK_FAILED', 'DOUBLE_CHECK');
    }

    let completed = false;
    try {
      // A different process may have persisted a token immediately before our short claim transaction.
      const afterClaim = await this.requireCredentials(
        parsed.organizationId,
        parsed.connectionId,
        'DOUBLE_CHECK'
      );
      if (isCurrent(afterClaim, refreshBefore)) return afterClaim.accessToken;

      let refreshed: Awaited<ReturnType<MercadoLibreOAuthClient['refreshAccessToken']>>;
      let oauth: MercadoLibreOAuthClient;
      try {
        oauth = this.oauth ?? new MercadoLibreOAuthClient();
      } catch {
        throw new MercadoLibreCredentialError('CONFIGURATION_ERROR', 'PROVIDER_REQUEST');
      }
      try {
        refreshed = await oauth.refreshAccessToken(afterClaim.refreshToken);
      } catch (error) {
        if (error instanceof MercadoLibreProviderError) throw providerRefreshError(error);
        throw new MercadoLibreCredentialError('PROVIDER_NETWORK_ERROR', 'PROVIDER_REQUEST');
      }
      const expiresAt = new Date(this.now().getTime() + refreshed.expiresInSeconds * 1000);
      const credentials: DecryptedCredentials = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken!,
        accessTokenExpiresAt: expiresAt.toISOString(),
        tokenMetadata: refreshedTokenMetadata(afterClaim.tokenMetadata, refreshed),
        credentialVersion: afterClaim.credentialVersion + 1
      };
      try {
        completed = await this.secrets.completeCredentialRefresh({
          organizationId: parsed.organizationId,
          connectionId: parsed.connectionId,
          expectedVersion: afterClaim.credentialVersion,
          leaseId,
          credentials
        });
      } catch (error) {
        if (error instanceof SecretCipherError) {
          throw new MercadoLibreCredentialError('CREDENTIAL_ENCRYPTION_FAILED', 'ENCRYPT');
        }
        throw new MercadoLibreCredentialError(
          'REFRESH_COMPLETE_RPC_FAILED',
          'CAS_COMPLETE',
          error instanceof CredentialRefreshCompleteError ? { casFailure: error.code } : {}
        );
      }
      if (completed) return credentials.accessToken;

      const latest = await this.getRefreshCompletionState({
        organizationId: parsed.organizationId,
        connectionId: parsed.connectionId,
        leaseId,
        expectedVersion: afterClaim.credentialVersion
      });
      if (latest.credentials && isCurrent(latest.credentials, refreshBefore)) {
        return latest.credentials.accessToken;
      }
      throw new MercadoLibreCredentialError(
        'REFRESH_CAS_REJECTED',
        'CAS_COMPLETE',
        { casFailure: 'CAS_REJECTED', ...latest.diagnostics }
      );
    } catch (error) {
      if (error instanceof MercadoLibreCredentialError) throw error;
      throw new MercadoLibreCredentialError('REFRESH_UNKNOWN_ERROR', 'PROVIDER_RESPONSE');
    } finally {
      if (!completed) {
        try {
          await this.secrets.releaseCredentialRefresh({
            organizationId: parsed.organizationId,
            connectionId: parsed.connectionId,
            leaseId
          });
        } catch {
          console.error('[meli-refresh]', {
            stage: 'RELEASE',
            code: 'REFRESH_RELEASE_FAILED',
            connectionId: parsed.connectionId
          });
        }
      }
    }
  }

  private async requireCredentials(
    organizationId: string,
    connectionId: string,
    stage: Extract<RefreshStage, 'READ' | 'DOUBLE_CHECK' | 'CAS_COMPLETE'>
  ): Promise<DecryptedCredentials> {
    try {
      const credentials = await this.secrets.readDecryptedCredentials(organizationId, connectionId);
      if (!credentials) throw new MercadoLibreCredentialError('CREDENTIALS_NOT_FOUND', stage);
      return credentials;
    } catch (error) {
      if (error instanceof MercadoLibreCredentialError) throw error;
      if (error instanceof SecretCipherError) {
        throw new MercadoLibreCredentialError('CREDENTIAL_DECRYPT_FAILED', 'DECRYPT');
      }
      throw new MercadoLibreCredentialError(
        stage === 'DOUBLE_CHECK' ? 'REFRESH_DOUBLE_CHECK_FAILED' : 'CREDENTIAL_READ_FAILED',
        stage
      );
    }
  }

  private async getRefreshCompletionState(input: {
    organizationId: string;
    connectionId: string;
    leaseId: string;
    expectedVersion: number;
  }): Promise<{
    credentials: DecryptedCredentials | null;
    diagnostics: RefreshErrorDetails;
  }> {
    let state: CredentialRefreshState | null = null;
    try {
      state = await this.secrets.getCredentialRefreshState(input);
    } catch {
      // A diagnostic read must not turn a confirmed CAS rejection into an RPC failure.
    }
    let credentials: DecryptedCredentials | null = null;
    try {
      credentials = await this.requireCredentials(
        input.organizationId,
        input.connectionId,
        'CAS_COMPLETE'
      );
    } catch {
      // The safe metadata below is sufficient to classify the rejected CAS.
    }
    return {
      credentials,
      diagnostics: {
        expectedVersion: input.expectedVersion,
        actualVersion: state?.credentialVersion ?? null,
        leasePresent: state?.leasePresent ?? false,
        leaseMatches: state?.leaseMatches ?? false
      }
    };
  }

  private async waitForPeerRefresh(
    organizationId: string,
    connectionId: string,
    refreshBefore: Date
  ): Promise<DecryptedCredentials | null> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const latest = await this.requireCredentials(organizationId, connectionId, 'DOUBLE_CHECK');
      if (isCurrent(latest, refreshBefore)) return latest;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }
}

function isCurrent(credentials: DecryptedCredentials, refreshBefore: Date): boolean {
  return Date.parse(credentials.accessTokenExpiresAt) > refreshBefore.getTime();
}

function providerRefreshError(error: MercadoLibreProviderError): MercadoLibreCredentialError {
  const code: RefreshErrorCode =
    error.kind === 'provider_network_error'
      ? 'PROVIDER_NETWORK_ERROR'
      : error.kind === 'provider_timeout'
        ? 'PROVIDER_TIMEOUT'
        : error.kind === 'provider_http_error'
          ? 'PROVIDER_HTTP_ERROR'
          : error.kind === 'invalid_refresh_token'
            ? 'PROVIDER_INVALID_REFRESH_TOKEN'
            : 'PROVIDER_RESPONSE_INVALID';
  const stage: RefreshStage =
    error.kind === 'provider_http_error' || error.kind === 'invalid_refresh_token'
      ? 'PROVIDER_RESPONSE'
      : 'PROVIDER_REQUEST';
  return new MercadoLibreCredentialError(code, stage, error.details);
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
