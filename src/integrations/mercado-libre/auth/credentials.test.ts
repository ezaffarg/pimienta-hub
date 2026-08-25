import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DecryptedCredentials } from '@/infrastructure/database/oauth-foundations';
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
    const readDecryptedCredentials = vi
      .fn()
      .mockResolvedValue(
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

    await expect(service.getValidAccessToken({ organizationId, connectionId })).rejects.toThrow(
      'token_refresh_failed'
    );
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
          .mockRejectedValue(new MercadoLibreCredentialError('token_refresh_failed'))
      } as never,
      () => now,
      () => connectionId
    );

    await expect(service.getValidAccessToken({ organizationId, connectionId })).rejects.toEqual(
      expect.objectContaining({ kind: 'token_refresh_failed', message: 'token_refresh_failed' })
    );
    expect(completeCredentialRefresh).not.toHaveBeenCalled();
  });
});
