import { describe, expect, it, vi } from 'vitest';
import {
  assignStoreToMembership,
  revokeStoreFromMembership
} from './store-assignment-provisioning';

vi.mock('server-only', () => ({}));

vi.mock('./server-context', () => ({
  requireServerAuthorizationContext: vi.fn(async () => ({
    organizationId: 'orgA',
    userId: 'owner',
    role: 'Owner',
    roleSource: 'persistent'
  }))
}));

const deps = () => {
  const assignments = new Map<
    string,
    { membershipId: string; storeId: string; organizationId: string }
  >();
  return {
    memberships: {
      listByOrganization: async () => [
        { id: 'm1', organizationId: 'orgA', clerkUserId: 'u1', role: 'Employee' as const }
      ]
    },
    stores: {
      getByOrganizationAndId: async () => ({
        id: 's1',
        organizationId: 'orgA',
        name: 'Store',
        status: 'active' as const
      })
    },
    assignments: {
      listByMembership: async () => [...assignments.values()],
      create: async (assignment: {
        membershipId: string;
        storeId: string;
        organizationId: string;
      }) => {
        assignments.set('m1:s1', assignment);
        return assignment;
      },
      remove: async () => {
        assignments.delete('m1:s1');
        return true;
      }
    }
  };
};

describe('Store assignment provisioning', () => {
  it('assigns and revokes within the active Organization', async () => {
    const dependencies = deps();
    expect(
      await assignStoreToMembership({ membershipId: 'm1', storeId: 's1' }, dependencies)
    ).toMatchObject({ status: 'created' });
    expect(
      await assignStoreToMembership({ membershipId: 'm1', storeId: 's1' }, dependencies)
    ).toMatchObject({ status: 'already_assigned' });
    expect(
      await revokeStoreFromMembership({ membershipId: 'm1', storeId: 's1' }, dependencies)
    ).toEqual({ status: 'revoked' });
    expect(
      await revokeStoreFromMembership({ membershipId: 'm1', storeId: 's1' }, dependencies)
    ).toEqual({ status: 'not_assigned' });
  });
});
