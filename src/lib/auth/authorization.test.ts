import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { APPROVED_ROLES, PERMISSIONS, hasPermission, resolveApprovedRole } from './authorization';

describe('RBAC policy', () => {
  it('maps only approved Clerk membership roles', () => {
    expect(resolveApprovedRole('org:admin')).toBe('Owner');
    expect(resolveApprovedRole('org:member')).toBe('Employee');
    expect(resolveApprovedRole('org:manager')).toBeNull();
    expect(resolveApprovedRole('client-supplied-role')).toBeNull();
  });

  it('uses a default-deny permission matrix for every approved role', () => {
    expect(APPROVED_ROLES).toEqual(['Owner', 'Manager', 'Employee', 'Client']);

    expect(hasPermission('Owner', 'products.read')).toBe(true);
    expect(hasPermission('Owner', 'products.write')).toBe(true);
    expect(hasPermission('Owner', 'users.read')).toBe(true);
    expect(hasPermission('Owner', 'users.write')).toBe(true);

    expect(hasPermission('Manager', 'products.write')).toBe(true);
    expect(hasPermission('Manager', 'users.read')).toBe(true);
    expect(hasPermission('Manager', 'users.write')).toBe(false);

    expect(hasPermission('Employee', 'products.read')).toBe(true);
    expect(hasPermission('Employee', 'products.write')).toBe(false);
    expect(hasPermission('Employee', 'users.read')).toBe(false);

    for (const permission of PERMISSIONS) {
      expect(hasPermission('Client', permission)).toBe(false);
    }
  });
});
