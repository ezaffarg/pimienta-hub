import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  OAuthFoundationRepository,
  auditMetadata,
  newOAuthAttemptState
} from './oauth-foundations';

describe('OAuth foundation validation', () => {
  it('generates opaque state with sufficient entropy representation', () => {
    const state = newOAuthAttemptState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(newOAuthAttemptState()).not.toBe(state);
  });

  it('allows small metadata and rejects secret-like fields', () => {
    expect(auditMetadata({ outcome: 'created' })).toEqual({ outcome: 'created' });
    expect(() => auditMetadata({ access_token: 'secret' })).toThrow();
  });

  it('encrypts pending OAuth tokens and binds a reconnect target before persistence', async () => {
    vi.stubEnv('INTEGRATION_SECRETS_MASTER_KEY', Buffer.alloc(32, 7).toString('base64url'));
    const single = vi.fn().mockResolvedValue({
      data: {
        id: '10000000-0000-4000-8000-000000000003',
        oauth_attempt_id: '10000000-0000-4000-8000-000000000001',
        organization_id: 'org_test',
        actor_membership_id: '10000000-0000-4000-8000-000000000002',
        provider: 'mercado-libre',
        purpose: 'reconnect',
        target_connection_id: '10000000-0000-4000-8000-000000000004',
        external_account_id: '123',
        display_name: 'ML_TEST',
        access_token_expires_at: '2030-01-01T00:00:00.000Z',
        expires_at: '2030-01-01T00:20:00.000Z'
      },
      error: null
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(
      (_payload: {
        target_connection_id: string | null;
        encrypted_access_token: string;
        encrypted_refresh_token: string | null;
      }) => {
        return { select };
      }
    );
    const client = { from: vi.fn(() => ({ insert })) };
    const repository = new OAuthFoundationRepository(client as never);

    await repository.createPendingOAuthAuthorization({
      oauthAttemptId: '10000000-0000-4000-8000-000000000001',
      organizationId: 'org_test',
      actorMembershipId: '10000000-0000-4000-8000-000000000002',
      provider: 'mercado-libre',
      purpose: 'reconnect',
      targetConnectionId: '10000000-0000-4000-8000-000000000004',
      externalAccountId: '123',
      displayName: 'ML_TEST',
      accessToken: 'access-token-plaintext',
      refreshToken: 'refresh-token-plaintext',
      accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:20:00.000Z'
    });

    const payload = insert.mock.calls[0]?.[0];
    if (!payload) throw new Error('Expected pending authorization insert');
    expect(payload.target_connection_id).toBe('10000000-0000-4000-8000-000000000004');
    expect(payload.encrypted_access_token).not.toContain('access-token-plaintext');
    expect(payload.encrypted_refresh_token).not.toContain('refresh-token-plaintext');
    vi.unstubAllEnvs();
  });

  it('encrypts both rotated credentials before the compare-and-swap RPC', async () => {
    vi.stubEnv('INTEGRATION_SECRETS_MASTER_KEY', Buffer.alloc(32, 7).toString('base64url'));
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const repository = new OAuthFoundationRepository({ rpc } as never);

    await expect(
      repository.completeCredentialRefresh({
        organizationId: 'org_test',
        connectionId: '10000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
        leaseId: '10000000-0000-4000-8000-000000000002',
        credentials: {
          accessToken: 'rotated-access-token-plaintext',
          refreshToken: 'rotated-refresh-token-plaintext',
          accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
          tokenMetadata: { token_type: 'bearer' },
          credentialVersion: 2
        }
      })
    ).resolves.toBe(true);

    const payload = rpc.mock.calls[0]?.[1] as Record<string, string>;
    expect(payload.p_encrypted_access_token).not.toContain('rotated-access-token-plaintext');
    expect(payload.p_encrypted_refresh_token).not.toContain('rotated-refresh-token-plaintext');
    vi.unstubAllEnvs();
  });

  it('returns only safe CAS state metadata', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        credential_version: 2,
        refresh_lease_id: '10000000-0000-4000-8000-000000000002'
      },
      error: null
    });
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const repository = new OAuthFoundationRepository({ from: vi.fn(() => query) } as never);

    await expect(
      repository.getCredentialRefreshState({
        organizationId: 'org_test',
        connectionId: '10000000-0000-4000-8000-000000000001',
        leaseId: '10000000-0000-4000-8000-000000000002'
      })
    ).resolves.toEqual({ credentialVersion: 2, leasePresent: true, leaseMatches: true });
    expect(query.select).toHaveBeenCalledWith('credential_version, refresh_lease_id');
  });

  it('filters pending previews by actor binding and expiration', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      gt: vi.fn(),
      maybeSingle
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.gt.mockReturnValue(query);
    const repository = new OAuthFoundationRepository({ from: vi.fn(() => query) } as never);

    await expect(
      repository.getPendingOAuthAuthorizationForActor({
        id: '10000000-0000-4000-8000-000000000003',
        organizationId: 'org_test',
        actorMembershipId: '10000000-0000-4000-8000-000000000002',
        provider: 'mercado-libre',
        purpose: 'admin_connect',
        now: '2030-01-01T00:00:00.000Z'
      })
    ).resolves.toBeNull();

    expect(query.eq).toHaveBeenCalledWith(
      'actor_membership_id',
      '10000000-0000-4000-8000-000000000002'
    );
    expect(query.gt).toHaveBeenCalledWith('expires_at', '2030-01-01T00:00:00.000Z');
  });

  it('classifies OAuth attempt state only inside its actor and organization binding', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { expires_at: '2029-01-01T00:00:00.000Z', consumed_at: null },
      error: null
    });
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const repository = new OAuthFoundationRepository({ from: vi.fn(() => query) } as never);

    await expect(
      repository.getOAuthAttemptState({
        organizationId: 'org_test',
        actorMembershipId: '10000000-0000-4000-8000-000000000002',
        state: 'a'.repeat(32),
        now: '2030-01-01T00:00:00.000Z'
      })
    ).resolves.toBe('expired');
    expect(query.eq).toHaveBeenCalledWith(
      'actor_membership_id',
      '10000000-0000-4000-8000-000000000002'
    );
  });

  it('consumes a pending authorization only once', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: '10000000-0000-4000-8000-000000000003' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const query = {
      update: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      gt: vi.fn(),
      select: vi.fn(),
      maybeSingle
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.gt.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const repository = new OAuthFoundationRepository({ from: vi.fn(() => query) } as never);
    const input = {
      id: '10000000-0000-4000-8000-000000000003',
      organizationId: 'org_test',
      actorMembershipId: '10000000-0000-4000-8000-000000000002',
      provider: 'mercado-libre' as const,
      purpose: 'admin_connect' as const,
      now: '2030-01-01T00:00:00.000Z'
    };

    await expect(repository.consumePendingOAuthAuthorization(input)).resolves.toBe(true);
    await expect(repository.consumePendingOAuthAuthorization(input)).resolves.toBe(false);
  });

  it('finalizes admin onboarding from an opaque pending handle without caller-supplied credentials', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          outcome: 'created',
          store_id: '10000000-0000-4000-8000-000000000004',
          connection_id: '10000000-0000-4000-8000-000000000005'
        }
      ],
      error: null
    });
    const repository = new OAuthFoundationRepository({ rpc } as never);

    await expect(
      repository.finalizeAdminPendingOnboarding({
        organizationId: 'org_test',
        actorMembershipId: '10000000-0000-4000-8000-000000000002',
        pendingAuthorizationId: '10000000-0000-4000-8000-000000000003',
        storeName: 'ML Test'
      })
    ).resolves.toEqual({
      outcome: 'created',
      storeId: '10000000-0000-4000-8000-000000000004',
      connectionId: '10000000-0000-4000-8000-000000000005'
    });

    expect(rpc).toHaveBeenCalledWith('finalize_admin_pending_integration_onboarding', {
      p_organization_id: 'org_test',
      p_actor_membership_id: '10000000-0000-4000-8000-000000000002',
      p_pending_authorization_id: '10000000-0000-4000-8000-000000000003',
      p_store_name: 'ML Test'
    });
  });

  it('accepts the reconnected outcome without exposing credentials', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          outcome: 'reconnected',
          store_id: '10000000-0000-4000-8000-000000000004',
          connection_id: '10000000-0000-4000-8000-000000000005'
        }
      ],
      error: null
    });
    const repository = new OAuthFoundationRepository({ rpc } as never);

    await expect(
      repository.finalizeAdminPendingOnboarding({
        organizationId: 'org_test',
        actorMembershipId: '10000000-0000-4000-8000-000000000002',
        pendingAuthorizationId: '10000000-0000-4000-8000-000000000003',
        storeName: 'ML Test'
      })
    ).resolves.toMatchObject({ outcome: 'reconnected' });
  });
});
