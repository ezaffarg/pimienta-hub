import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolvePersistentHubRole } from './persistent-role';

describe('Persistent Hub role resolution', () => {
  it.each(['Owner', 'Manager', 'Employee', 'Client'] as const)(
    'resolves %s only from the Organization-scoped membership',
    async (role) => {
      const findByOrganizationAndClerkUser = vi.fn().mockResolvedValue({ role });

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
});
