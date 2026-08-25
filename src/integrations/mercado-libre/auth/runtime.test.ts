import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { completeMercadoLibreOAuth, OAuthRuntimeError, startMercadoLibreOAuth } from './runtime';

const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://app.example.test/api/integrations/mercado-libre/callback',
  pkceEnabled: true,
  authorizationUrl: 'https://auth.mercadolibre.com.ar/authorization',
  tokenUrl: 'https://api.mercadolibre.com/oauth/token',
  userUrl: 'https://api.mercadolibre.com/users/me'
};

const membership = {
  id: '10000000-0000-4000-8000-000000000001',
  organizationId: 'org_test',
  clerkUserId: 'user_test',
  role: 'Owner' as const
};

function dependencies(role: 'Owner' | 'Manager' | 'Employee' | 'Client' = 'Owner') {
  const foundations = {
    createOAuthAttempt: vi.fn(),
    getOAuthAttemptState: vi.fn().mockResolvedValue('active'),
    consumeOAuthAttempt: vi.fn().mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000002',
      organizationId: 'org_test',
      actorMembershipId: membership.id,
      provider: 'mercado-libre' as const,
      purpose: 'admin_connect' as const,
      encryptedCodeVerifier: 'ciphertext',
      keyVersion: 1,
      expiresAt: '2030-01-01T00:10:00.000Z'
    }),
    decryptCodeVerifier: vi.fn().mockReturnValue('test-verifier'),
    createPendingOAuthAuthorization: vi.fn()
  };
  const client = {
    buildAuthorizationUrl: vi
      .fn()
      .mockReturnValue('https://auth.mercadolibre.com.ar/authorization?state=opaque'),
    exchangeAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      tokenType: 'bearer'
    }),
    getCurrentUser: vi.fn().mockResolvedValue({ externalAccountId: '123', displayName: 'ML Test' })
  };
  return {
    now: () => new Date('2030-01-01T00:00:00.000Z'),
    config: () => config,
    client: client as never,
    foundations: foundations as never,
    memberships: {
      findByOrganizationAndClerkUser: vi.fn().mockResolvedValue({ ...membership, role })
    },
    connections: { findByProviderAndExternalAccount: vi.fn().mockResolvedValue(null) },
    context: async () => ({
      userId: 'user_test',
      organizationId: 'org_test',
      role,
      roleSource: 'persistent' as 'persistent' | 'clerk-fallback'
    }),
    test: { foundations, client }
  };
}

describe('Mercado Libre OAuth runtime', () => {
  it.each([
    ['Owner', 'admin_connect', true],
    ['Manager', 'reconnect', true],
    ['Employee', 'admin_connect', false],
    ['Client', 'client_self_onboard', true]
  ] as const)('enforces the connect policy for %s', async (role, purpose, allowed) => {
    const setup = dependencies(role);
    const action = startMercadoLibreOAuth({ origin: 'https://app.example.test', purpose }, setup);

    if (allowed) {
      await expect(action).resolves.toEqual({ authorizationUrl: expect.any(String) });
      expect(setup.test.foundations.createOAuthAttempt).toHaveBeenCalledOnce();
    } else {
      await expect(action).rejects.toBeInstanceOf(Error);
      expect(setup.test.foundations.createOAuthAttempt).not.toHaveBeenCalled();
    }
  });

  it('denies cross-origin and invalid purpose input before creating state', async () => {
    const setup = dependencies();
    await expect(
      startMercadoLibreOAuth({ origin: 'https://evil.example', purpose: 'admin_connect' }, setup)
    ).rejects.toBeInstanceOf(Error);
    await expect(
      startMercadoLibreOAuth({ origin: 'https://app.example.test', purpose: 'invalid' }, setup)
    ).rejects.toBeInstanceOf(Error);
    expect(setup.test.foundations.createOAuthAttempt).not.toHaveBeenCalled();
  });

  it('does not exchange a token for invalid, expired, consumed, or replayed state', async () => {
    for (const state of [null, 'expired', 'consumed'] as const) {
      const setup = dependencies();
      setup.test.foundations.getOAuthAttemptState.mockResolvedValue(state);
      await expect(
        completeMercadoLibreOAuth({ code: 'test-code', state: 'a'.repeat(32) }, setup)
      ).rejects.toBeInstanceOf(OAuthRuntimeError);
      expect(setup.test.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
    }

    const replay = dependencies();
    replay.test.foundations.consumeOAuthAttempt.mockResolvedValue(null);
    await expect(
      completeMercadoLibreOAuth({ code: 'test-code', state: 'a'.repeat(32) }, replay)
    ).rejects.toThrow('consumed_state');
    expect(replay.test.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('consumes provider denials without exchanging a token', async () => {
    const setup = dependencies();
    await expect(
      completeMercadoLibreOAuth({ error: 'access_denied', state: 'a'.repeat(32) }, setup)
    ).rejects.toThrow('oauth_denied');
    expect(setup.test.foundations.consumeOAuthAttempt).toHaveBeenCalledOnce();
    expect(setup.test.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('denies a callback when the current session is not persistently bound to the attempt', async () => {
    const setup = dependencies();
    setup.context = async () => ({
      userId: 'user_test',
      organizationId: 'org_test',
      role: 'Owner',
      roleSource: 'clerk-fallback'
    });

    await expect(
      completeMercadoLibreOAuth({ code: 'test-code', state: 'a'.repeat(32) }, setup)
    ).rejects.toThrow('session_mismatch');
    expect(setup.test.foundations.consumeOAuthAttempt).not.toHaveBeenCalled();
  });

  it('normalizes identity, persists a pending authorization, and never returns tokens', async () => {
    const setup = dependencies();
    const result = await completeMercadoLibreOAuth(
      { code: 'test-code', state: 'a'.repeat(32) },
      setup
    );

    expect(result).toEqual({ status: 'READY_FOR_ONBOARDING', displayName: 'ML Test' });
    expect(JSON.stringify(result)).not.toContain('test-access-token');
    expect(setup.test.foundations.createPendingOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        externalAccountId: '123',
        displayName: 'ML Test',
        expiresAt: '2030-01-01T00:20:00.000Z'
      })
    );
  });

  it('returns opaque conflicts without creating a pending authorization', async () => {
    const setup = dependencies();
    setup.connections.findByProviderAndExternalAccount.mockResolvedValue({
      organizationId: 'other_org',
      status: 'active'
    });

    await expect(
      completeMercadoLibreOAuth({ code: 'test-code', state: 'a'.repeat(32) }, setup)
    ).rejects.toThrow('connection_conflict');
    expect(setup.test.foundations.createPendingOAuthAuthorization).not.toHaveBeenCalled();
  });

  it('keeps normal connect blocked for an existing active connection', async () => {
    const setup = dependencies();
    setup.connections.findByProviderAndExternalAccount.mockResolvedValue({
      organizationId: 'org_test',
      provider: 'mercado-libre',
      externalAccountId: '123',
      status: 'active'
    });

    await expect(
      completeMercadoLibreOAuth({ code: 'test-code', state: 'a'.repeat(32) }, setup)
    ).rejects.toThrow('already_connected');
    expect(setup.test.foundations.createPendingOAuthAuthorization).not.toHaveBeenCalled();
  });

  it.each(['active', 'disabled'] as const)(
    'allows explicit reconnect for a same-tenant %s connection without creating it',
    async (status) => {
      const setup = dependencies();
      setup.test.foundations.consumeOAuthAttempt.mockResolvedValue({
        id: '10000000-0000-4000-8000-000000000002',
        organizationId: 'org_test',
        actorMembershipId: membership.id,
        provider: 'mercado-libre',
        purpose: 'reconnect',
        encryptedCodeVerifier: 'ciphertext',
        keyVersion: 1,
        expiresAt: '2030-01-01T00:10:00.000Z'
      });
      setup.connections.findByProviderAndExternalAccount.mockResolvedValue({
        id: '10000000-0000-4000-8000-000000000003',
        organizationId: 'org_test',
        provider: 'mercado-libre',
        externalAccountId: '123',
        status
      });

      await expect(
        completeMercadoLibreOAuth({ code: 'test-code', state: 'a'.repeat(32) }, setup)
      ).resolves.toEqual({ status: 'READY_FOR_RECONNECT', displayName: 'ML Test' });
      expect(setup.test.foundations.createPendingOAuthAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({
          targetConnectionId: '10000000-0000-4000-8000-000000000003'
        })
      );
    }
  );

  it('fails closed for reconnect without a same-tenant Mercado Libre target', async () => {
    const missing = dependencies();
    missing.test.foundations.consumeOAuthAttempt.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000002',
      organizationId: 'org_test',
      actorMembershipId: membership.id,
      provider: 'mercado-libre',
      purpose: 'reconnect',
      encryptedCodeVerifier: 'ciphertext',
      keyVersion: 1,
      expiresAt: '2030-01-01T00:10:00.000Z'
    });
    await expect(
      completeMercadoLibreOAuth({ code: 'test-code', state: 'a'.repeat(32) }, missing)
    ).rejects.toThrow('reconnect_target_not_found');
    expect(missing.test.foundations.createPendingOAuthAuthorization).not.toHaveBeenCalled();

    const wrongProvider = dependencies();
    wrongProvider.test.foundations.consumeOAuthAttempt.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000002',
      organizationId: 'org_test',
      actorMembershipId: membership.id,
      provider: 'mercado-libre',
      purpose: 'reconnect',
      encryptedCodeVerifier: 'ciphertext',
      keyVersion: 1,
      expiresAt: '2030-01-01T00:10:00.000Z'
    });
    wrongProvider.connections.findByProviderAndExternalAccount.mockResolvedValue({
      organizationId: 'org_test',
      provider: 'shopify',
      externalAccountId: '123',
      status: 'active'
    });
    await expect(
      completeMercadoLibreOAuth({ code: 'test-code', state: 'a'.repeat(32) }, wrongProvider)
    ).rejects.toThrow('connection_conflict');
    expect(wrongProvider.test.foundations.createPendingOAuthAuthorization).not.toHaveBeenCalled();
  });

  it('fails closed when the resolved connection identity differs from /users/me', async () => {
    const setup = dependencies();
    setup.test.foundations.consumeOAuthAttempt.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000002',
      organizationId: 'org_test',
      actorMembershipId: membership.id,
      provider: 'mercado-libre',
      purpose: 'reconnect',
      encryptedCodeVerifier: 'ciphertext',
      keyVersion: 1,
      expiresAt: '2030-01-01T00:10:00.000Z'
    });
    setup.connections.findByProviderAndExternalAccount.mockResolvedValue({
      organizationId: 'org_test',
      provider: 'mercado-libre',
      externalAccountId: 'different-account',
      status: 'active'
    });

    await expect(
      completeMercadoLibreOAuth({ code: 'test-code', state: 'a'.repeat(32) }, setup)
    ).rejects.toThrow('connection_conflict');
    expect(setup.test.foundations.createPendingOAuthAuthorization).not.toHaveBeenCalled();
  });
});
