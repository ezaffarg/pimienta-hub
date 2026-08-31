import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getMercadoLibreEventOperationsSummary } from './admin-service';
import { AuthorizationDeniedError } from '@/lib/auth/authorization';

const summary = {
  receivedBacklog: 1,
  retryDue: 2,
  processing: 0,
  processedRecent: 3,
  failed: 2,
  retryExhausted: 1,
  lastRun: null
};

function dependencies(role: 'Owner' | 'Manager' | 'Employee' | 'Client') {
  return {
    context: vi.fn().mockResolvedValue({
      userId: 'user_test',
      organizationId: 'org_test',
      role,
      roleSource: 'persistent' as const
    }),
    memberships: {
      findByOrganizationAndClerkUser: vi.fn().mockResolvedValue({
        id: '10000000-0000-4000-8000-000000000001',
        clerkUserId: 'user_test',
        organizationId: 'org_test',
        role
      })
    },
    maintenance: { summary: vi.fn().mockResolvedValue(summary) }
  };
}

describe('getMercadoLibreEventOperationsSummary', () => {
  it.each(['Owner', 'Manager'] as const)('allows persistent %s', async (role) => {
    const test = dependencies(role);
    await expect(getMercadoLibreEventOperationsSummary(test)).resolves.toEqual(summary);
    expect(test.maintenance.summary).toHaveBeenCalledWith('org_test');
  });

  it.each(['Employee', 'Client'] as const)('denies %s before persistence', async (role) => {
    const test = dependencies(role);
    await expect(getMercadoLibreEventOperationsSummary(test)).rejects.toBeInstanceOf(
      AuthorizationDeniedError
    );
    expect(test.maintenance.summary).not.toHaveBeenCalled();
  });

  it('denies Clerk fallback and mismatched persisted membership', async () => {
    const fallback = dependencies('Owner');
    fallback.context.mockResolvedValue({
      userId: 'user_test',
      organizationId: 'org_test',
      role: 'Owner',
      roleSource: 'clerk-fallback'
    });
    await expect(getMercadoLibreEventOperationsSummary(fallback)).rejects.toBeInstanceOf(
      AuthorizationDeniedError
    );

    const mismatch = dependencies('Manager');
    mismatch.memberships.findByOrganizationAndClerkUser.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000001',
      clerkUserId: 'user_test',
      organizationId: 'org_other',
      role: 'Manager'
    });
    await expect(getMercadoLibreEventOperationsSummary(mismatch)).rejects.toBeInstanceOf(
      AuthorizationDeniedError
    );
  });
});
