import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  CredentialRefreshCompleteFailureCode,
  CredentialRefreshClaim,
  CredentialRefreshState,
  DecryptedCredentials
} from '@/infrastructure/database/oauth-foundations';
import { OAuthFoundationRepository } from '@/infrastructure/database/oauth-foundations';
import { SecretCipherError } from '@/lib/crypto/integration-secrets';
import { MercadoLibreOAuthClient, MercadoLibreProviderError } from './client';

const EXPIRY_SAFETY_WINDOW_MS = 120_000;
const TOKEN_METADATA_VALUE_MAX_LENGTH = 256;
const TOKEN_SCOPE_MAX_LENGTH = 1000;

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
  databaseCode?: string;
  expectedVersion?: number;
  actualVersion?: number | null;
  leasePresent?: boolean;
  leaseMatches?: boolean;
  refreshFailureStage?: CredentialRefreshFailureStage;
  refreshCallsAttempted?: number;
  refreshCallsSucceeded?: number;
}

export type CasCompleteFailureCode = CredentialRefreshCompleteFailureCode | 'CAS_CONFLICT';

export const credentialRefreshFailureStages = [
  'refresh_credential_read',
  'refresh_credential_decrypt',
  'refresh_lease',
  'refresh_post_claim_validation',
  'refresh_provider_request',
  'refresh_provider_response',
  'refresh_response_validation',
  'refresh_encrypt',
  'refresh_cas',
  'refresh_post_persist_validation'
] as const;

export type CredentialRefreshFailureStage = (typeof credentialRefreshFailureStages)[number];

export interface CredentialRefreshDiagnostics {
  failureStage: CredentialRefreshFailureStage | null;
  casFailure: CasCompleteFailureCode | null;
  providerCallsAttempted: number;
  providerCallsSucceeded: number;
}

export type CredentialRefreshDiagnosticsObserver = (
  diagnostics: CredentialRefreshDiagnostics
) => void;

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

  async getValidAccessToken(
    input: {
      organizationId: string;
      connectionId: string;
    },
    observe?: CredentialRefreshDiagnosticsObserver
  ): Promise<string> {
    const activity = { providerCallsAttempted: 0, providerCallsSucceeded: 0 };
    try {
      const accessToken = await this.resolveValidAccessToken(input, activity);
      publishRefreshDiagnostics(observe, {
        failureStage: null,
        casFailure: null,
        ...activity
      });
      return accessToken;
    } catch (error) {
      if (!(error instanceof MercadoLibreCredentialError)) throw error;
      const observed = new MercadoLibreCredentialError(error.code, error.stage, {
        ...error.details,
        refreshFailureStage: credentialRefreshFailureStage(error),
        refreshCallsAttempted: activity.providerCallsAttempted,
        refreshCallsSucceeded: activity.providerCallsSucceeded
      });
      publishRefreshDiagnostics(observe, {
        failureStage: observed.details.refreshFailureStage ?? null,
        casFailure: observed.details.casFailure ?? null,
        ...activity
      });
      throw observed;
    }
  }

  private async resolveValidAccessToken(
    input: { organizationId: string; connectionId: string },
    activity: Pick<
      CredentialRefreshDiagnostics,
      'providerCallsAttempted' | 'providerCallsSucceeded'
    >
  ): Promise<string> {
    const parsed = z
      .object({ organizationId: z.string().trim().min(1).max(255), connectionId: z.uuid() })
      .strict()
      .parse(input);
    const refreshBefore = new Date(this.now().getTime() + EXPIRY_SAFETY_WINDOW_MS);
    const current = await this.requireCredentials(
      parsed.organizationId,
      parsed.connectionId,
      'READ',
      'refresh_credential_read'
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
      throw new MercadoLibreCredentialError('REFRESH_CLAIM_FAILED', 'CLAIM', {
        refreshFailureStage: 'refresh_lease'
      });
    }

    if (claim.outcome === 'not_found')
      throw new MercadoLibreCredentialError('CREDENTIALS_NOT_FOUND', 'CLAIM', {
        refreshFailureStage: 'refresh_lease'
      });
    if (claim.outcome === 'busy') {
      const refreshedByPeer = await this.waitForPeerRefresh(
        parsed.organizationId,
        parsed.connectionId,
        refreshBefore
      );
      if (refreshedByPeer) return refreshedByPeer.accessToken;
      throw new MercadoLibreCredentialError('REFRESH_BUSY', 'CLAIM', {
        refreshFailureStage: 'refresh_lease'
      });
    }
    if (claim.outcome === 'already_refreshed') {
      const latest = await this.requireCredentials(
        parsed.organizationId,
        parsed.connectionId,
        'DOUBLE_CHECK',
        'refresh_post_persist_validation'
      );
      if (isCurrent(latest, refreshBefore)) return latest.accessToken;
      throw new MercadoLibreCredentialError('REFRESH_DOUBLE_CHECK_FAILED', 'DOUBLE_CHECK', {
        refreshFailureStage: 'refresh_post_persist_validation'
      });
    }

    let completed = false;
    try {
      // A different process may have persisted a token immediately before our short claim transaction.
      const afterClaim = await this.requireCredentials(
        parsed.organizationId,
        parsed.connectionId,
        'DOUBLE_CHECK',
        'refresh_post_claim_validation'
      );
      if (claim.credentialVersion !== afterClaim.credentialVersion) {
        throw new MercadoLibreCredentialError('REFRESH_DOUBLE_CHECK_FAILED', 'DOUBLE_CHECK', {
          refreshFailureStage: 'refresh_post_claim_validation'
        });
      }
      if (isCurrent(afterClaim, refreshBefore)) return afterClaim.accessToken;

      let refreshed: Awaited<ReturnType<MercadoLibreOAuthClient['refreshAccessToken']>>;
      let oauth: MercadoLibreOAuthClient;
      try {
        oauth = this.oauth ?? new MercadoLibreOAuthClient();
      } catch {
        throw new MercadoLibreCredentialError('CONFIGURATION_ERROR', 'PROVIDER_REQUEST', {
          refreshFailureStage: 'refresh_provider_request'
        });
      }
      activity.providerCallsAttempted += 1;
      try {
        refreshed = await oauth.refreshAccessToken(afterClaim.refreshToken);
        activity.providerCallsSucceeded += 1;
      } catch (error) {
        if (error instanceof MercadoLibreProviderError) {
          if (providerResponseReceived(error)) activity.providerCallsSucceeded += 1;
          throw providerRefreshError(error);
        }
        throw new MercadoLibreCredentialError('PROVIDER_NETWORK_ERROR', 'PROVIDER_REQUEST', {
          refreshFailureStage: 'refresh_provider_request'
        });
      }
      let credentials: DecryptedCredentials;
      try {
        const expiresAt = new Date(this.now().getTime() + refreshed.expiresInSeconds * 1000);
        credentials = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken!,
          accessTokenExpiresAt: expiresAt.toISOString(),
          tokenMetadata: refreshedTokenMetadata(afterClaim.tokenMetadata, refreshed),
          credentialVersion: afterClaim.credentialVersion + 1
        };
      } catch {
        throw new MercadoLibreCredentialError('PROVIDER_RESPONSE_INVALID', 'PROVIDER_REQUEST', {
          refreshFailureStage: 'refresh_response_validation'
        });
      }
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
          throw new MercadoLibreCredentialError('CREDENTIAL_ENCRYPTION_FAILED', 'ENCRYPT', {
            refreshFailureStage: 'refresh_encrypt'
          });
        }
        if (error instanceof MercadoLibreCredentialError) throw error;
        const casFailure = credentialRefreshCompleteFailure(error);
        if (!casFailure) {
          throw new MercadoLibreCredentialError('REFRESH_UNKNOWN_ERROR', 'CAS_COMPLETE', {
            refreshFailureStage: 'refresh_post_claim_validation'
          });
        }
        throw new MercadoLibreCredentialError('REFRESH_COMPLETE_RPC_FAILED', 'CAS_COMPLETE', {
          casFailure: casFailure.code,
          refreshFailureStage: 'refresh_cas',
          ...(casFailure.databaseCode ? { databaseCode: casFailure.databaseCode } : {})
        });
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
      throw new MercadoLibreCredentialError('REFRESH_CAS_REJECTED', 'CAS_COMPLETE', {
        casFailure: 'CAS_CONFLICT',
        refreshFailureStage: 'refresh_cas',
        ...latest.diagnostics
      });
    } catch (error) {
      if (error instanceof MercadoLibreCredentialError) throw error;
      throw new MercadoLibreCredentialError('REFRESH_UNKNOWN_ERROR', 'DOUBLE_CHECK', {
        refreshFailureStage: 'refresh_post_claim_validation'
      });
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
    stage: Extract<RefreshStage, 'READ' | 'DOUBLE_CHECK' | 'CAS_COMPLETE'>,
    failureStage: CredentialRefreshFailureStage
  ): Promise<DecryptedCredentials> {
    try {
      const credentials = await this.secrets.readDecryptedCredentials(organizationId, connectionId);
      if (!credentials) {
        throw new MercadoLibreCredentialError('CREDENTIALS_NOT_FOUND', stage, {
          refreshFailureStage: failureStage
        });
      }
      return credentials;
    } catch (error) {
      if (error instanceof MercadoLibreCredentialError) throw error;
      if (error instanceof SecretCipherError) {
        throw new MercadoLibreCredentialError('CREDENTIAL_DECRYPT_FAILED', 'DECRYPT', {
          refreshFailureStage: 'refresh_credential_decrypt'
        });
      }
      throw new MercadoLibreCredentialError(
        stage === 'DOUBLE_CHECK' ? 'REFRESH_DOUBLE_CHECK_FAILED' : 'CREDENTIAL_READ_FAILED',
        stage,
        { refreshFailureStage: failureStage }
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
        'CAS_COMPLETE',
        'refresh_post_persist_validation'
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
      const latest = await this.requireCredentials(
        organizationId,
        connectionId,
        'DOUBLE_CHECK',
        'refresh_post_persist_validation'
      );
      if (isCurrent(latest, refreshBefore)) return latest;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }
}

function isCurrent(credentials: DecryptedCredentials, refreshBefore: Date): boolean {
  return Date.parse(credentials.accessTokenExpiresAt) > refreshBefore.getTime();
}

function providerResponseReceived(error: MercadoLibreProviderError): boolean {
  return error.kind !== 'provider_network_error' && error.kind !== 'provider_timeout';
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
  const refreshFailureStage: CredentialRefreshFailureStage =
    error.kind === 'provider_response_invalid'
      ? 'refresh_response_validation'
      : stage === 'PROVIDER_RESPONSE'
        ? 'refresh_provider_response'
        : 'refresh_provider_request';
  return new MercadoLibreCredentialError(code, stage, {
    ...error.details,
    refreshFailureStage
  });
}

function credentialRefreshCompleteFailure(error: unknown): {
  code: CredentialRefreshCompleteFailureCode;
  databaseCode?: string;
} | null {
  const parsed = z
    .object({
      name: z.literal('CredentialRefreshCompleteError'),
      code: z.enum(['CAS_RPC_THROW', 'CAS_RPC_ERROR', 'CAS_RESPONSE_INVALID']),
      databaseCode: z
        .string()
        .regex(/^[A-Z0-9]{5,16}$/)
        .optional()
    })
    .passthrough()
    .safeParse(error);
  return parsed.success ? parsed.data : null;
}

function credentialRefreshFailureStage(
  error: MercadoLibreCredentialError
): CredentialRefreshFailureStage {
  if (error.details.refreshFailureStage) {
    return error.details.refreshFailureStage === 'refresh_cas' && !error.details.casFailure
      ? 'refresh_post_claim_validation'
      : error.details.refreshFailureStage;
  }
  if (error.stage === 'READ') return 'refresh_credential_read';
  if (error.stage === 'DECRYPT') return 'refresh_credential_decrypt';
  if (error.stage === 'CLAIM') return 'refresh_lease';
  if (error.stage === 'DOUBLE_CHECK') return 'refresh_post_persist_validation';
  if (error.stage === 'PROVIDER_REQUEST') {
    return error.code === 'PROVIDER_RESPONSE_INVALID'
      ? 'refresh_response_validation'
      : 'refresh_provider_request';
  }
  if (error.stage === 'PROVIDER_RESPONSE') return 'refresh_provider_response';
  if (error.stage === 'ENCRYPT') return 'refresh_encrypt';
  if (error.stage === 'CAS_COMPLETE' && error.details.casFailure) return 'refresh_cas';
  return 'refresh_post_claim_validation';
}

function publishRefreshDiagnostics(
  observe: CredentialRefreshDiagnosticsObserver | undefined,
  diagnostics: CredentialRefreshDiagnostics
): void {
  try {
    observe?.(diagnostics);
  } catch {
    // Observability must never change credential behavior.
  }
}

function refreshedTokenMetadata(
  previous: Record<string, string>,
  token: { tokenType: string; scope?: string; userId?: string }
): Record<string, string> {
  return {
    ...previous,
    token_type: token.tokenType,
    ...(token.scope && token.scope.length <= TOKEN_SCOPE_MAX_LENGTH ? { scope: token.scope } : {}),
    ...(token.userId && token.userId.length <= TOKEN_METADATA_VALUE_MAX_LENGTH
      ? { user_id: token.userId }
      : {})
  };
}

export { EXPIRY_SAFETY_WINDOW_MS };
