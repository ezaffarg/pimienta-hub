import { describe, expect, it, vi } from 'vitest';
import type { HubMembership, StoreRecord } from '@/infrastructure/database/repositories';
import { hasPermission } from './authorization';
import {
  canAccessStore,
  listStoresWithinScope,
  resolveStoreScope,
  type StoreScope
} from './store-scope';

vi.mock('server-only', () => ({}));

const organizationId = 'org_a';
const otherOrganizationId = 'org_b';

function membership(role: HubMembership['role'], id = 'membership_a'): HubMembership {
  return { id, organizationId, clerkUserId: 'user_a', role };
}

function store(
  id: string,
  storeOrganizationId = organizationId
): Pick<StoreRecord, 'id' | 'organizationId'> {
  return { id, organizationId: storeOrganizationId };
}

function assignmentRepository(assignments: { storeId: string; organizationId: string }[]) {
  return {
    listByMembership: vi
      .fn()
      .mockResolvedValue(
        assignments.map((assignment) => ({ membershipId: 'membership_a', ...assignment }))
      )
  };
}

describe('persistent Store Scope', () => {
  it.each(['Owner', 'Manager'] as const)(
    '%s receives all Stores only inside the active Organization',
    async (role) => {
      const assignments = assignmentRepository([]);
      const scope = await resolveStoreScope(
        { organizationId, membership: membership(role) },
        assignments
      );

      expect(scope).toEqual({ kind: 'all-stores' });
      expect(canAccessStore(scope, organizationId, store('store_a'))).toBe(true);
      expect(canAccessStore(scope, organizationId, store('store_b', otherOrganizationId))).toBe(
        false
      );
      expect(assignments.listByMembership).not.toHaveBeenCalled();
    }
  );

  it.each(['Employee', 'Client'] as const)('%s can access only assigned Stores', async (role) => {
    const assignments = assignmentRepository([{ storeId: 'store_a', organizationId }]);
    const scope = await resolveStoreScope(
      { organizationId, membership: membership(role) },
      assignments
    );

    expect(canAccessStore(scope, organizationId, store('store_a'))).toBe(true);
    expect(canAccessStore(scope, organizationId, store('store_b'))).toBe(false);
    expect(assignments.listByMembership).toHaveBeenCalledWith(organizationId, 'membership_a');
  });

  it.each(['Employee', 'Client'] as const)(
    '%s with no assignments receives an explicit empty scope',
    async (role) => {
      const scope = await resolveStoreScope(
        { organizationId, membership: membership(role) },
        assignmentRepository([])
      );

      expect(scope.kind).toBe('assigned-stores');
      expect(canAccessStore(scope, organizationId, store('store_a'))).toBe(false);
    }
  );

  it('ignores an assignment returned from another Organization', async () => {
    const scope = await resolveStoreScope(
      { organizationId, membership: membership('Employee') },
      assignmentRepository([{ storeId: 'store_b', organizationId: otherOrganizationId }])
    );

    expect(canAccessStore(scope, organizationId, store('store_b', otherOrganizationId))).toBe(
      false
    );
  });

  it('denies missing, cross-tenant, and unknown memberships', async () => {
    const assignments = assignmentRepository([{ storeId: 'store_a', organizationId }]);
    const missing = await resolveStoreScope({ organizationId, membership: null }, assignments);
    const crossTenant = await resolveStoreScope(
      {
        organizationId,
        membership: { ...membership('Employee'), organizationId: otherOrganizationId }
      },
      assignments
    );
    const unknown = await resolveStoreScope(
      {
        organizationId,
        membership: { ...membership('Employee'), role: 'Unknown' as HubMembership['role'] }
      },
      assignments
    );

    expect(canAccessStore(missing, organizationId, store('store_a'))).toBe(false);
    expect(canAccessStore(crossTenant, organizationId, store('store_a'))).toBe(false);
    expect(canAccessStore(unknown, organizationId, store('store_a'))).toBe(false);
    expect(assignments.listByMembership).not.toHaveBeenCalled();
  });

  it('lists all tenant Stores only for an all-Stores scope', async () => {
    const store: StoreRecord = { id: 'store_a', organizationId, name: 'A', status: 'active' };
    const repository = {
      listByOrganization: vi.fn().mockResolvedValue([store]),
      listByOrganizationAndIds: vi.fn().mockResolvedValue([store])
    };

    await expect(
      listStoresWithinScope({ kind: 'all-stores' }, organizationId, repository)
    ).resolves.toEqual([store]);
    expect(repository.listByOrganization).toHaveBeenCalledWith(organizationId);
    expect(repository.listByOrganizationAndIds).not.toHaveBeenCalled();
  });

  it('lists assigned Store IDs server-side and never treats an empty scope as all Stores', async () => {
    const repository = {
      listByOrganization: vi.fn(),
      listByOrganizationAndIds: vi.fn().mockResolvedValue([])
    };
    const emptyScope: StoreScope = { kind: 'assigned-stores', storeIds: new Set() };

    await expect(listStoresWithinScope(emptyScope, organizationId, repository)).resolves.toEqual(
      []
    );
    expect(repository.listByOrganization).not.toHaveBeenCalled();
    expect(repository.listByOrganizationAndIds).toHaveBeenCalledWith(organizationId, []);
  });

  it('keeps permissions independent from Store Scope', async () => {
    const scope = await resolveStoreScope(
      { organizationId, membership: membership('Client') },
      assignmentRepository([{ storeId: 'store_a', organizationId }])
    );

    expect(canAccessStore(scope, organizationId, store('store_a'))).toBe(true);
    expect(hasPermission('Client', 'products.read')).toBe(false);
  });
});
