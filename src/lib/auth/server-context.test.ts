import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

import {
  AuthenticationRequiredError,
  OrganizationRequiredError,
  requireServerTenantContext,
  withServerTenantContext
} from './server-context';

describe('Server tenant context', () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it('rejects an unauthenticated request', async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });

    await expect(requireServerTenantContext()).rejects.toBeInstanceOf(AuthenticationRequiredError);
  });

  it('rejects an authenticated request without an active Organization', async () => {
    authMock.mockResolvedValue({ userId: 'user_123', orgId: null });

    await expect(requireServerTenantContext()).rejects.toBeInstanceOf(OrganizationRequiredError);
  });

  it('returns the tenant context resolved by Clerk', async () => {
    authMock.mockResolvedValue({ userId: 'user_123', orgId: 'org_123' });

    await expect(requireServerTenantContext()).resolves.toEqual({
      userId: 'user_123',
      organizationId: 'org_123'
    });
  });

  it('does not accept client-supplied identity or tenant values', () => {
    expect(requireServerTenantContext).toHaveLength(0);
  });

  it('returns consistent HTTP errors before executing a handler', async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    const handler = vi.fn();

    const response = await withServerTenantContext(handler);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required'
      }
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
