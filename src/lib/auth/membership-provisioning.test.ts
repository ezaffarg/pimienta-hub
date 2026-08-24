import { describe, expect, it, vi } from 'vitest';
import type { HubMembership } from '@/infrastructure/database/repositories';
import { provisionMembership } from './membership-provisioning';

vi.mock('server-only', () => ({}));

const membership: HubMembership = {
  id: 'm1',
  organizationId: 'orgA',
  clerkUserId: 'userB',
  role: 'Employee'
};

vi.mock('./server-context', () => ({
  requireServerAuthorizationContext: vi.fn(async () => ({
    organizationId: 'orgA',
    userId: 'owner',
    role: 'Owner',
    roleSource: 'persistent'
  }))
}));

describe('provisionMembership', () => {
  it('creates a tenant-scoped membership after Clerk membership validation', async () => {
    const create = vi.fn(async () => membership);
    const result = await provisionMembership(
      { targetClerkUserId: 'userB', role: 'Employee' },
      {
        isOrganizationMember: async (organizationId, userId) =>
          organizationId === 'orgA' && userId === 'userB',
        repository: {
          findByOrganizationAndClerkUser: async () => null,
          create
        }
      }
    );
    expect(result).toEqual({ status: 'created', membership });
    expect(create).toHaveBeenCalledWith({
      organizationId: 'orgA',
      clerkUserId: 'userB',
      role: 'Employee'
    });
  });

  it('returns a controlled duplicate result without overwriting the role', async () => {
    const create = vi.fn();
    const result = await provisionMembership(
      { targetClerkUserId: 'userB', role: 'Client' },
      {
        isOrganizationMember: async () => true,
        repository: {
          findByOrganizationAndClerkUser: async () => membership,
          create
        }
      }
    );
    expect(result).toEqual({ status: 'already_exists', membership });
    expect(create).not.toHaveBeenCalled();
  });
});
