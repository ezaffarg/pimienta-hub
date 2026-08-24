import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PersistenceError } from '@/infrastructure/database/repositories';
import { resolveHubRole, resolvePersistentHubRole } from './persistent-role';

describe('Persistent Hub role resolution', () => {
  it.each(['Owner', 'Manager', 'Employee', 'Client'] as const)(
    'resolves %s only from the Organization-scoped membership',
    async (role) => {
      const findByOrganizationAndClerkUser = vi.fn().mockResolvedValue({
        organizationId: 'org_a',
        clerkUserId: 'user_a',
        role
      });

      await expect(
        resolvePersistentHubRole({ findByOrganizationAndClerkUser }, 'org_a', 'user_a')
      ).resolves.toBe(role);
      expect(findByOrganizationAndClerkUser).toHaveBeenCalledWith('org_a', 'user_a');
    }
  );

  it('does not grant a role when membership is missing', async () => {
    await expect(
      resolvePersistentHubRole(
        { findByOrganizationAndClerkUser: vi.fn().mockResolvedValue(null) },
        'org_a',
        'user_a'
      )
    ).resolves.toBeNull();
  });

  it.each(['Owner', 'Manager', 'Employee', 'Client'] as const)(
    'uses persistent %s before the Clerk role',
    async (role) => {
      const findByOrganizationAndClerkUser = vi.fn().mockResolvedValue({
        organizationId: 'org_a',
        clerkUserId: 'user_a',
        role
      });

      await expect(
        resolveHubRole({ findByOrganizationAndClerkUser }, 'org_a', 'user_a', 'org:member')
      ).resolves.toEqual({ role, source: 'persistent' });
      expect(findByOrganizationAndClerkUser).toHaveBeenCalledWith('org_a', 'user_a');
    }
  );

  it.each([
    ['org:admin', 'Owner'],
    ['org:member', 'Employee']
  ] as const)(
    'uses Clerk %s only after a successful absent membership lookup',
    async (clerkRole, role) => {
      await expect(
        resolveHubRole(
          { findByOrganizationAndClerkUser: vi.fn().mockResolvedValue(null) },
          'org_a',
          'user_a',
          clerkRole
        )
      ).resolves.toEqual({ role, source: 'clerk-fallback' });
    }
  );

  it('denies an unknown persistent role without falling back to Clerk', async () => {
    await expect(
      resolveHubRole(
        {
          findByOrganizationAndClerkUser: vi.fn().mockResolvedValue({
            organizationId: 'org_a',
            clerkUserId: 'user_a',
            role: 'Unknown'
          })
        },
        'org_a',
        'user_a',
        'org:admin'
      )
    ).resolves.toBeNull();
  });

  it('propagates a database failure instead of using the Clerk fallback', async () => {
    await expect(
      resolveHubRole(
        {
          findByOrganizationAndClerkUser: vi
            .fn()
            .mockRejectedValue(new PersistenceError('database unavailable'))
        },
        'org_a',
        'user_a',
        'org:admin'
      )
    ).rejects.toBeInstanceOf(PersistenceError);
  });

  it('uses the Owner membership produced by bootstrap on the next role resolution', async () => {
    await expect(
      resolveHubRole(
        {
          findByOrganizationAndClerkUser: vi.fn().mockResolvedValue({
            organizationId: 'org_a',
            clerkUserId: 'user_first_owner',
            role: 'Owner'
          })
        },
        'org_a',
        'user_first_owner',
        'org:member'
      )
    ).resolves.toEqual({ role: 'Owner', source: 'persistent' });
  });

  it('denies a membership returned for a different Organization', async () => {
    const findByOrganizationAndClerkUser = vi.fn().mockResolvedValue({
      organizationId: 'org_b',
      clerkUserId: 'user_a',
      role: 'Owner'
    });

    await expect(
      resolveHubRole({ findByOrganizationAndClerkUser }, 'org_a', 'user_a', 'org:admin')
    ).resolves.toBeNull();
    expect(findByOrganizationAndClerkUser).toHaveBeenCalledWith('org_a', 'user_a');
  });
});
