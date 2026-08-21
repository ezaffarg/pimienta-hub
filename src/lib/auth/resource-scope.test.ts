import { beforeEach, describe, expect, it } from 'vitest';
import { fakeProducts, type Product } from '@/constants/mock-api';
import { fakeUsers, type User } from '@/constants/mock-api-users';
import { MOCK_ORGANIZATIONS } from '@/constants/mock-tenants';

const productOrgA: Product = {
  id: 101,
  organizationId: MOCK_ORGANIZATIONS.orgA,
  name: 'Product Org A',
  description: 'Deterministic security fixture',
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

const userOrgA: User = {
  id: 301,
  organizationId: MOCK_ORGANIZATIONS.orgA,
  first_name: 'Ada',
  last_name: 'OrgA',
  email: 'ada@example.test',
  phone: '111',
  status: 'Active',
  role: 'Developer',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
};

const userOrgB: User = {
  ...userOrgA,
  id: 302,
  organizationId: MOCK_ORGANIZATIONS.orgB,
  email: 'org-b@example.test'
};

describe('Organization resource scope', () => {
  beforeEach(() => {
    fakeProducts.records = [{ ...productOrgA }, { ...productOrgB }];
    fakeUsers.records = [{ ...userOrgA }, { ...userOrgB }];
  });

  it('lists only resources belonging to the server-side Organization', async () => {
    const products = await fakeProducts.getProducts({
      organizationId: MOCK_ORGANIZATIONS.orgA
    });
    const users = await fakeUsers.getUsers({ organizationId: MOCK_ORGANIZATIONS.orgA });

    expect(products.products).toEqual([productOrgA]);
    expect(users.users).toEqual([userOrgA]);
  });

  it('resolves a same-tenant product and hides a cross-tenant product', async () => {
    await expect(
      fakeProducts.getProductById(productOrgA.id, MOCK_ORGANIZATIONS.orgA)
    ).resolves.toMatchObject({ success: true, product: productOrgA });
    await expect(
      fakeProducts.getProductById(productOrgB.id, MOCK_ORGANIZATIONS.orgA)
    ).resolves.toMatchObject({ success: false });
  }, 7000);

  it('assigns creations to the server-side Organization despite client data', async () => {
    const created = await fakeProducts.createProduct(
      {
        ...productOrgA,
        organizationId: MOCK_ORGANIZATIONS.orgB
      } as Omit<Product, 'id' | 'organizationId' | 'created_at' | 'updated_at' | 'photo_url'>,
      MOCK_ORGANIZATIONS.orgA
    );

    expect(created.product.organizationId).toBe(MOCK_ORGANIZATIONS.orgA);
  });

  it('does not update or delete cross-tenant resources', async () => {
    await expect(
      fakeProducts.updateProduct(
        productOrgB.id,
        {
          name: 'Attempted cross-tenant update',
          description: productOrgB.description,
          price: productOrgB.price,
          category: productOrgB.category
        },
        MOCK_ORGANIZATIONS.orgA
      )
    ).resolves.toMatchObject({ success: false });

    await expect(fakeUsers.deleteUser(userOrgB.id, MOCK_ORGANIZATIONS.orgA)).resolves.toMatchObject(
      { success: false }
    );
  });
});
