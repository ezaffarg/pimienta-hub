import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));

import {
  AuthenticationRequiredError,
  OrganizationRequiredError,
  requireServerAuthorizationContext,
  requireServerTenantContext,
  withServerPermission
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

  it('resolves the approved role from Clerk server-side membership', async () => {
    authMock.mockResolvedValue({
      userId: 'user_123',
      orgId: 'org_123',
      orgRole: 'org:admin'
    });

    await expect(requireServerAuthorizationContext()).resolves.toEqual({
      userId: 'user_123',
      organizationId: 'org_123',
      role: 'Owner'
    });
  });

  it('does not accept client-supplied identity or tenant values', () => {
    expect(requireServerTenantContext).toHaveLength(0);
  });

  it('returns consistent HTTP errors before executing a handler', async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    const handler = vi.fn();

    const response = await withServerPermission('products.read', handler);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required'
      }
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 403 when an authenticated user has no active Organization', async () => {
    authMock.mockResolvedValue({ userId: 'user_123', orgId: null });

    const response = await withServerPermission('products.read', vi.fn());

    expect(response.status).toBe(403);
  });

  it('denies a valid role without the required permission', async () => {
    authMock.mockResolvedValue({
      userId: 'user_123',
      orgId: 'org_123',
      orgRole: 'org:member'
    });
    const handler = vi.fn();

    const response = await withServerPermission('products.write', handler);

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows a valid role with the required permission', async () => {
    authMock.mockResolvedValue({
      userId: 'user_123',
      orgId: 'org_123',
      orgRole: 'org:admin'
    });
    const handler = vi.fn(() => new Response(null, { status: 204 }));

    const response = await withServerPermission('users.write', handler);

    expect(response.status).toBe(204);
    expect(handler).toHaveBeenCalledWith({
      userId: 'user_123',
      organizationId: 'org_123',
      role: 'Owner'
    });
  });

  it('denies an authenticated user with an unsupported Clerk role', async () => {
    authMock.mockResolvedValue({
      userId: 'user_123',
      orgId: 'org_123',
      orgRole: 'role-sent-by-client'
    });
    const handler = vi.fn();

    const response = await withServerPermission('products.read', handler);

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
