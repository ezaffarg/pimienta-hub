import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import {
  HubMembershipRepository,
  PersistenceError,
  StoreAssignmentRepository,
  StoreRepository
} from './repositories';

function clientFor(builder: Record<string, unknown>): SupabaseClient {
  return { from: vi.fn(() => builder) } as unknown as SupabaseClient;
}

describe('server-only repositories', () => {
  it('looks up memberships by Organization and Clerk user, never globally', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'membership_a',
        organization_id: 'org_a',
        clerk_user_id: 'user_a',
        role: 'Manager'
      },
      error: null
    });
    const clerkUserFilter = vi.fn(() => ({ maybeSingle }));
    const organizationFilter = vi.fn(() => ({ eq: clerkUserFilter }));
    const repository = new HubMembershipRepository(
      clientFor({ select: vi.fn(() => ({ eq: organizationFilter })) })
    );

    await expect(
      repository.findByOrganizationAndClerkUser('org_a', 'user_a')
    ).resolves.toMatchObject({
      role: 'Manager'
    });
    expect(organizationFilter).toHaveBeenCalledWith('organization_id', 'org_a');
    expect(clerkUserFilter).toHaveBeenCalledWith('clerk_user_id', 'user_a');
  });

  it('lists Stores by Organization and has no global get-by-id API', async () => {
    const organizationFilter = vi.fn().mockResolvedValue({ data: [], error: null });
    const repository = new StoreRepository(
      clientFor({ select: vi.fn(() => ({ eq: organizationFilter })) })
    );

    await expect(repository.listByOrganization('org_a')).resolves.toEqual([]);
    expect(organizationFilter).toHaveBeenCalledWith('organization_id', 'org_a');
    expect('getById' in repository).toBe(false);
  });

  it('lists assignments only with membership and Organization', async () => {
    const membershipFilter = vi.fn().mockResolvedValue({ data: [], error: null });
    const organizationFilter = vi.fn(() => ({ eq: membershipFilter }));
    const repository = new StoreAssignmentRepository(
      clientFor({ select: vi.fn(() => ({ eq: organizationFilter })) })
    );

    await expect(repository.listByMembership('org_a', 'membership_a')).resolves.toEqual([]);
    expect(organizationFilter).toHaveBeenCalledWith('organization_id', 'org_a');
    expect(membershipFilter).toHaveBeenCalledWith('membership_id', 'membership_a');
  });

  it('preserves persistence failures for server-side handling', async () => {
    const repository = new HubMembershipRepository(
      clientFor({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: null, error: { message: 'db failed' } })
            }))
          }))
        }))
      })
    );

    await expect(
      repository.findByOrganizationAndClerkUser('org_a', 'user_a')
    ).rejects.toBeInstanceOf(PersistenceError);
  });
});
