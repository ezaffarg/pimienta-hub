import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { hasPermission } from './authorization';

describe('OAuth and audit permissions', () => {
  it.each(['Owner', 'Manager'] as const)(
    'allows %s to read audit and connect providers',
    (role) => {
      expect(hasPermission(role, 'audit:read')).toBe(true);
      expect(hasPermission(role, 'integration:connect')).toBe(true);
      expect(hasPermission(role, 'integration:reconnect')).toBe(true);
      expect(hasPermission(role, 'listings:recover')).toBe(true);
    }
  );

  it.each(['Employee', 'Client'] as const)(
    'denies %s global audit and connection management',
    (role) => {
      expect(hasPermission(role, 'audit:read')).toBe(false);
      expect(hasPermission(role, 'integration:connect')).toBe(false);
      expect(hasPermission(role, 'listings:recover')).toBe(false);
    }
  );

  it('limits Client to contextual self-connect capability', () => {
    expect(hasPermission('Client', 'integration:self_connect')).toBe(true);
    expect(hasPermission('Employee', 'integration:self_connect')).toBe(false);
  });
});
