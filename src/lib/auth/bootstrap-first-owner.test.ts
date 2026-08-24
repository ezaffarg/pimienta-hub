import { beforeEach, describe, expect, it, vi } from 'vitest';

const { contextMock, bootstrapMock } = vi.hoisted(() => ({
  contextMock: vi.fn(),
  bootstrapMock: vi.fn()
}));

vi.mock('server-only', () => ({}));
vi.mock('./server-context', () => ({ requireServerBootstrapContext: contextMock }));
vi.mock('@/infrastructure/database/repositories', () => ({
  HubMembershipRepository: class {
    bootstrapFirstOwner = bootstrapMock;
  }
}));

import { bootstrapFirstOwner } from './bootstrap-first-owner';

describe('bootstrapFirstOwner server boundary', () => {
  beforeEach(() => {
    contextMock.mockReset();
    bootstrapMock.mockReset();
  });
  it('uses only the Clerk-derived tenant and user', async () => {
    contextMock.mockResolvedValue({ organizationId: 'org_server', userId: 'user_server' });
    bootstrapMock.mockResolvedValue({ outcome: 'created', membershipId: 'membership_a' });

    await expect(bootstrapFirstOwner()).resolves.toEqual({
      outcome: 'created',
      membershipId: 'membership_a'
    });
    expect(bootstrapMock).toHaveBeenCalledWith('org_server', 'user_server');
  });

  it('does not invoke persistence when Clerk authorization denies', async () => {
    contextMock.mockRejectedValue(new Error('denied'));

    await expect(bootstrapFirstOwner()).rejects.toThrow('denied');
    expect(bootstrapMock).not.toHaveBeenCalled();
  });
});
