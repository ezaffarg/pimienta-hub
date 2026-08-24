import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, membershipLookupMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipLookupMock: vi.fn()
}));

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
vi.mock('@/infrastructure/database/repositories', () => ({
  HubMembershipRepository: class {
    findByOrganizationAndClerkUser = membershipLookupMock;
  }
}));

import { GET as getProduct } from './products/[id]/route';
import { GET as getProducts, POST as createProduct } from './products/route';
import { fakeProducts, type Product } from '@/constants/mock-api';
import { MOCK_ORGANIZATIONS } from '@/constants/mock-tenants';
import { NextRequest } from 'next/server';

const productOrgA: Product = {
  id: 101,
  organizationId: MOCK_ORGANIZATIONS.orgA,
  name: 'Product Org A',
  description: 'Deterministic route fixture',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  price: 100,
  photo_url: 'https://example.test/product-a.png',
  category: 'Security'
};

const productOrgB: Product = {
  ...productOrgA,
  id: 202,
  organizationId: MOCK_ORGANIZATIONS.orgB,
  name: 'Product Org B'
};

function productRequest(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/products', {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {})
  });
}

describe('protected product route handlers', () => {
  beforeEach(() => {
    authMock.mockReset();
    membershipLookupMock.mockReset();
    membershipLookupMock.mockResolvedValue(null);
    fakeProducts.records = [{ ...productOrgA }, { ...productOrgB }];
  });

  it('returns 401 before executing a handler without a session', async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });

    const response = await getProducts(productRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required' }
    });
  });

  it('returns 403 when an authenticated user has no active Organization', async () => {
    authMock.mockResolvedValue({ userId: 'user_123', orgId: null, orgRole: 'org:admin' });

    const response = await getProducts(productRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'ORGANIZATION_REQUIRED' }
    });
  });

  it('returns 403 before processing a write for insufficient permission', async () => {
    authMock.mockResolvedValue({
      userId: 'user_123',
      orgId: MOCK_ORGANIZATIONS.orgA,
      orgRole: 'org:member'
    });

    const response = await createProduct(productRequest({}));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AUTHORIZATION_DENIED' }
    });
  });

  it('hides a cross-tenant product with 404', async () => {
    authMock.mockResolvedValue({
      userId: 'user_123',
      orgId: MOCK_ORGANIZATIONS.orgA,
      orgRole: 'org:admin'
    });

    const response = await getProduct(new NextRequest('http://localhost/api/products/202'), {
      params: Promise.resolve({ id: '202' })
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } });
  }, 7000);

  it('returns 400 for an invalid body after server-side authorization', async () => {
    authMock.mockResolvedValue({
      userId: 'user_123',
      orgId: MOCK_ORGANIZATIONS.orgA,
      orgRole: 'org:admin'
    });

    const response = await createProduct(productRequest({ ...productOrgA, price: -1 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('creates a valid product in the Organization resolved on the server', async () => {
    authMock.mockResolvedValue({
      userId: 'user_123',
      orgId: MOCK_ORGANIZATIONS.orgA,
      orgRole: 'org:admin'
    });

    const response = await createProduct(
      productRequest({
        name: 'Validated product',
        description: 'Deterministic route fixture',
        price: 10,
        category: 'Security'
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      product: { organizationId: MOCK_ORGANIZATIONS.orgA }
    });
  });
});
