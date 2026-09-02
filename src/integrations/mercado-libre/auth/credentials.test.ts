import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  CredentialRefreshCompleteError,
  type DecryptedCredentials
} from '@/infrastructure/database/oauth-foundations';
import { SecretCipherError } from '@/lib/crypto/integration-secrets';
import { MercadoLibreCredentialError, MercadoLibreCredentialService } from './credentials';

const organizationId = 'org_test';
const connectionId = '10000000-0000-4000-8000-000000000001';
const now = new Date('2030-01-01T00:00:00.000Z');

function credentials(overrides: Partial<DecryptedCredentials> = {}): DecryptedCredentials {
  return {
    accessToken: 'expired-access-token',
    refreshToken: 'refresh-token-v1',
    accessTokenExpiresAt: '2029-12-31T23:00:00.000Z',
    tokenMetadata: {},
    credentialVersion: 1,
    ...overrides
  };
}

function refreshResult(overrides = {}) {
  return {
    accessToken: 'rotated-access-token',
    refreshToken: 'refresh-token-v2',
    expiresInSeconds: 3600,
    tokenType: 'bearer',
    ...overrides
  };
}

describe('MercadoLibreCredentialService', () => {
  it('reuses a token outside the safety window without refresh', async () => {
    const readDecryptedCredentials = vi.fn().mockResolvedValue(
      credentials({
        accessToken: 'current-access-token',
        accessTokenExpiresAt: '2030-01-01T00:10:00.000Z'
      })
    );
    const refreshAccessToken = vi.fn();
    const service = new MercadoLibreCredentialService(
      { readDecryptedCredentials } as never,
      { refreshAccessToken } as never,
      () => now,
      () => connectionId
    );

    await expect(service.getValidAccessToken({ organizationId, connectionId })).resolves.toBe(
      'current-access-token'
    );
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('fails safely when the stored credential is missing', async () => {
    const refreshAccessToken = vi.fn();
    const service = new MercadoLibreCredentialService(
      { readDecryptedCredentials: vi.fn().mockResolvedValue(null) } as never,
      { refreshAccessToken } as never,
      () => now,
      () => connectionId
    );

    await expect(
      service.getValidAccessToken({ organizationId, connectionId })
    ).rejects.toMatchObject({ code: 'CREDENTIALS_NOT_FOUND', stage: 'READ' });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('claims, refreshes and atomically persists rotated credentials', async () => {
    const original = credentials();
    const completeCredentialRefresh = vi.fn().mockResolvedValue(true);
    const service = new MercadoLibreCredentialService(
      {
        readDecryptedCredentials: vi.fn().mockResolvedValue(original),
        claimCredentialRefresh: vi
          .fn()
          .mockResolvedValue({ outcome: 'claimed', credentialVersion: 1 }),
        completeCredentialRefresh,
        releaseCredentialRefresh: vi.fn()
      } as never,
      { refreshAccessToken: vi.fn().mockResolvedValue(refreshResult()) } as never,
      () => now,
      () => connectionId
    );

    await expect(service.getValidAccessToken({ organizationId, connectionId })).resolves.toBe(
      'rotated-access-token'
    );
    expect(completeCredentialRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 1,
        credentials: expect.objectContaining({
          refreshToken: 'refresh-token-v2',
          credentialVersion: 2
        })
      })
    );
  });

  it('preserves prior credentials when the provider refresh fails', async () => {
    const completeCredentialRefresh = vi.fn();
    const releaseCredentialRefresh = vi.fn().mockResolvedValue(true);
    const service = new MercadoLibreCredentialService(
      {
        readDecryptedCredentials: vi.fn().mockResolvedValue(credentials()),
        claimCredentialRefresh: vi
          .fn()
          .mockResolvedValue({ outcome: 'claimed', credentialVersion: 1 }),
        completeCredentialRefresh,
        releaseCredentialRefresh
      } as never,
      { refreshAccessToken: vi.fn().mockRejectedValue(new Error('provider unavailable')) } as never,
      () => now,
      () => connectionId
    );

    await expect(
      service.getValidAccessToken({ organizationId, connectionId })
    ).rejects.toMatchObject({
      code: 'PROVIDER_NETWORK_ERROR',
      stage: 'PROVIDER_REQUEST'
    });
    expect(completeCredentialRefresh).not.toHaveBeenCalled();
    expect(releaseCredentialRefresh).toHaveBeenCalledOnce();
  });

  it('does not overwrite credentials after a failed stale CAS and uses the newer token', async () => {
    const latest = credentials({
      accessToken: 'peer-access-token',
      refreshToken: 'peer-refresh-token',
      accessTokenExpiresAt: '2030-01-01T01:00:00.000Z',
      credentialVersion: 2
    });
    const service = new MercadoLibreCredentialService(
      {
        readDecryptedCredentials: vi
          .fn()
          .mockResolvedValueOnce(credentials())
          .mockResolvedValueOnce(credentials())
          .mockResolvedValueOnce(latest),
        claimCredentialRefresh: vi
          .fn()
          .mockResolvedValue({ outcome: 'claimed', credentialVersion: 1 }),
        completeCredentialRefresh: vi.fn().mockResolvedValue(false),
        releaseCredentialRefresh: vi.fn().mockResolvedValue(false)
      } as never,
      { refreshAccessToken: vi.fn().mockResolvedValue(refreshResult()) } as never,
      () => now,
      () => connectionId
    );

    await expect(service.getValidAccessToken({ organizationId, connectionId })).resolves.toBe(
      'peer-access-token'
    );
  });

  it('waits for a concurrent winner and never invokes a second refresh', async () => {
    let stored = credentials();
    let claimed = false;
    let resolveRefresh: ((value: ReturnType<typeof refreshResult>) => void) | undefined;
    const refreshAccessToken = vi.fn(
      () => new Promise<ReturnType<typeof refreshResult>>((resolve) => (resolveRefresh = resolve))
    );
    const service = new MercadoLibreCredentialService(
      {
        readDecryptedCredentials: vi.fn().mockImplementation(async () => stored),
        claimCredentialRefresh: vi.fn().mockImplementation(async () => {
          if (claimed) return { outcome: 'busy', credentialVersion: stored.credentialVersion };
          claimed = true;
          return { outcome: 'claimed', credentialVersion: stored.credentialVersion };
        }),
        completeCredentialRefresh: vi.fn().mockImplementation(async (input) => {
          stored = input.credentials;
          return true;
        }),
        releaseCredentialRefresh: vi.fn().mockResolvedValue(true)
      } as never,
      { refreshAccessToken } as never,
      () => now,
      () => connectionId
    );

    const first = service.getValidAccessToken({ organizationId, connectionId });
    await vi.waitFor(() => expect(refreshAccessToken).toHaveBeenCalledOnce());
    const second = service.getValidAccessToken({ organizationId, connectionId });
    resolveRefresh?.(refreshResult({ accessToken: 'peer-access-token' }));

    await expect(first).resolves.toBe('peer-access-token');
    await expect(second).resolves.toBe('peer-access-token');
    expect(refreshAccessToken).toHaveBeenCalledOnce();
  });

  it('treats a stale lease claim as recoverable and malformed refresh responses as non-persistent', async () => {
    const completeCredentialRefresh = vi.fn();
    const service = new MercadoLibreCredentialService(
      {
        readDecryptedCredentials: vi.fn().mockResolvedValue(credentials()),
        claimCredentialRefresh: vi
          .fn()
          .mockResolvedValue({ outcome: 'claimed', credentialVersion: 1 }),
        completeCredentialRefresh,
        releaseCredentialRefresh: vi.fn().mockResolvedValue(true)
      } as never,
      {
        refreshAccessToken: vi
          .fn()
          .mockRejectedValue(
            new MercadoLibreCredentialError('PROVIDER_NETWORK_ERROR', 'PROVIDER_REQUEST')
          )
      } as never,
      () => now,
      () => connectionId
    );

    await expect(service.getValidAccessToken({ organizationId, connectionId })).rejects.toEqual(
      expect.objectContaining({ kind: 'PROVIDER_NETWORK_ERROR', message: 'PROVIDER_NETWORK_ERROR' })
    );
    expect(completeCredentialRefresh).not.toHaveBeenCalled();
  });

  it('classifies claim, decrypt, RPC complete, and CAS rejection failures', async () => {
    const claimFailure = new MercadoLibreCredentialService(
      {
        readDecryptedCredentials: vi.fn().mockResolvedValue(credentials()),
        claimCredentialRefresh: vi.fn().mockRejectedValue(new Error('db unavailable'))
      } as never,
      { refreshAccessToken: vi.fn() } as never,
      () => now,
      () => connectionId
    );
    await expect(
      claimFailure.getValidAccessToken({ organizationId, connectionId })
    ).rejects.toMatchObject({
      code: 'REFRESH_CLAIM_FAILED',
      stage: 'CLAIM'
    });

    const decryptFailure = new MercadoLibreCredentialService(
      { readDecryptedCredentials: vi.fn().mockRejectedValue(new SecretCipherError()) } as never,
      { refreshAccessToken: vi.fn() } as never,
      () => now,
      () => connectionId
    );
    await expect(
      decryptFailure.getValidAccessToken({ organizationId, connectionId })
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_DECRYPT_FAILED',
      stage: 'DECRYPT'
    });

    const casFailure = new MercadoLibreCredentialService(
      {
        readDecryptedCredentials: vi
          .fn()
          .mockResolvedValueOnce(credentials())
          .mockResolvedValueOnce(credentials())
          .mockResolvedValueOnce(credentials()),
        claimCredentialRefresh: vi
          .fn()
          .mockResolvedValue({ outcome: 'claimed', credentialVersion: 1 }),
        completeCredentialRefresh: vi.fn().mockResolvedValue(false),
        releaseCredentialRefresh: vi.fn().mockResolvedValue(true)
      } as never,
      { refreshAccessToken: vi.fn().mockResolvedValue(refreshResult()) } as never,
      () => now,
      () => connectionId
    );
    await expect(
      casFailure.getValidAccessToken({ organizationId, connectionId })
    ).rejects.toMatchObject({
      code: 'REFRESH_CAS_REJECTED',
      stage: 'CAS_COMPLETE',
      details: {
        casFailure: 'CAS_CONFLICT',
        expectedVersion: 1,
        actualVersion: null,
        leasePresent: false,
        leaseMatches: false
      }
    });

    for (const [casFailure, databaseCode] of [
      ['CAS_RPC_THROW', undefined],
      ['CAS_RPC_ERROR', 'PGRST202'],
      ['CAS_RESPONSE_INVALID', undefined]
    ] as const) {
      const rpcFailure = new MercadoLibreCredentialService(
        {
          readDecryptedCredentials: vi.fn().mockResolvedValue(credentials()),
          claimCredentialRefresh: vi
            .fn()
            .mockResolvedValue({ outcome: 'claimed', credentialVersion: 1 }),
          completeCredentialRefresh: vi
            .fn()
            .mockRejectedValue(new CredentialRefreshCompleteError(casFailure, databaseCode)),
          releaseCredentialRefresh: vi.fn().mockResolvedValue(true)
        } as never,
        { refreshAccessToken: vi.fn().mockResolvedValue(refreshResult()) } as never,
        () => now,
        () => connectionId
      );
      const error = await rpcFailure
        .getValidAccessToken({ organizationId, connectionId })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        code: 'REFRESH_COMPLETE_RPC_FAILED',
        stage: 'CAS_COMPLETE',
        details: {
          casFailure,
          ...(databaseCode ? { databaseCode } : {})
        }
      });
      expect(JSON.stringify(error)).not.toContain('refresh-token-v1');
      expect(JSON.stringify(error)).not.toContain('rotated-access-token');
    }
  });

  it('reports version, lease mismatch, and missing lease as safe CAS diagnostics', async () => {
    const cases = [
      {
        state: { credentialVersion: 2, leasePresent: true, leaseMatches: true },
        expected: { actualVersion: 2, leasePresent: true, leaseMatches: true }
      },
      {
        state: { credentialVersion: 1, leasePresent: true, leaseMatches: false },
        expected: { actualVersion: 1, leasePresent: true, leaseMatches: false }
      },
      {
        state: { credentialVersion: 1, leasePresent: false, leaseMatches: false },
        expected: { actualVersion: 1, leasePresent: false, leaseMatches: false }
      }
    ];

    for (const testCase of cases) {
      const service = new MercadoLibreCredentialService(
        {
          readDecryptedCredentials: vi.fn().mockResolvedValue(credentials()),
          claimCredentialRefresh: vi
            .fn()
            .mockResolvedValue({ outcome: 'claimed', credentialVersion: 1 }),
          completeCredentialRefresh: vi.fn().mockResolvedValue(false),
          getCredentialRefreshState: vi.fn().mockResolvedValue(testCase.state),
          releaseCredentialRefresh: vi.fn().mockResolvedValue(true)
        } as never,
        { refreshAccessToken: vi.fn().mockResolvedValue(refreshResult()) } as never,
        () => now,
        () => connectionId
      );
      const error = await service
        .getValidAccessToken({ organizationId, connectionId })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        code: 'REFRESH_CAS_REJECTED',
        details: { casFailure: 'CAS_CONFLICT', expectedVersion: 1, ...testCase.expected }
      });
      expect(JSON.stringify(error)).not.toContain('refresh-token-v1');
      expect(JSON.stringify(error)).not.toContain('rotated-access-token');
      expect(JSON.stringify(error)).not.toContain(connectionId);
    }
  });

  it('preserves the primary error when release also fails', async () => {
    const release = vi.fn().mockRejectedValue(new Error('release unavailable'));
    const service = new MercadoLibreCredentialService(
      {
        readDecryptedCredentials: vi.fn().mockResolvedValue(credentials()),
        claimCredentialRefresh: vi
          .fn()
          .mockResolvedValue({ outcome: 'claimed', credentialVersion: 1 }),
        releaseCredentialRefresh: release
      } as never,
      { refreshAccessToken: vi.fn().mockRejectedValue(new Error('network unavailable')) } as never,
      () => now,
      () => connectionId
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(
        service.getValidAccessToken({ organizationId, connectionId })
      ).rejects.toMatchObject({
        code: 'PROVIDER_NETWORK_ERROR',
        stage: 'PROVIDER_REQUEST'
      });
      expect(log).toHaveBeenCalledWith(
        '[meli-refresh]',
        expect.objectContaining({ code: 'REFRESH_RELEASE_FAILED', stage: 'RELEASE' })
      );
    } finally {
      log.mockRestore();
    }
  });

  it('classifies encryption failure and redacts credential values', async () => {
    const service = new MercadoLibreCredentialService(
      {
        readDecryptedCredentials: vi.fn().mockResolvedValue(credentials()),
        claimCredentialRefresh: vi
          .fn()
          .mockResolvedValue({ outcome: 'claimed', credentialVersion: 1 }),
        completeCredentialRefresh: vi.fn().mockRejectedValue(new SecretCipherError()),
        releaseCredentialRefresh: vi.fn().mockResolvedValue(true)
      } as never,
      { refreshAccessToken: vi.fn().mockResolvedValue(refreshResult()) } as never,
      () => now,
      () => connectionId
    );

    const promise = service.getValidAccessToken({ organizationId, connectionId });
    await expect(promise).rejects.toMatchObject({
      code: 'CREDENTIAL_ENCRYPTION_FAILED',
      stage: 'ENCRYPT'
    });
    try {
      await promise;
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('refresh-token-v1');
      expect(JSON.stringify(error)).not.toContain('rotated-access-token');
    }
  });
});
