import 'server-only';

export const APPROVED_ROLES = ['Owner', 'Manager', 'Employee', 'Client'] as const;

export type ApprovedRole = (typeof APPROVED_ROLES)[number];

export const PERMISSIONS = [
  'products.read',
  'products.write',
  'users.read',
  'users.write'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<ApprovedRole, readonly Permission[]>> = {
  Owner: ['products.read', 'products.write', 'users.read', 'users.write'],
  Manager: ['products.read', 'products.write', 'users.read'],
  Employee: ['products.read'],
  Client: []
};

const CLERK_ROLE_MAPPING: Readonly<Record<string, ApprovedRole>> = {
  'org:admin': 'Owner',
  'org:member': 'Employee'
};

export class AuthorizationDeniedError extends Error {
  constructor() {
    super('The current user is not authorized for this action');
    this.name = 'AuthorizationDeniedError';
  }
}

export function resolveApprovedRole(clerkRole: string | null | undefined): ApprovedRole | null {
  if (!clerkRole) {
    return null;
  }

  return CLERK_ROLE_MAPPING[clerkRole] ?? null;
}

export function hasPermission(role: ApprovedRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function requirePermission(role: ApprovedRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new AuthorizationDeniedError();
  }
}
