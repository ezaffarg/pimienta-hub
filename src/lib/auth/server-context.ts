import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { apiErrorResponse } from '@/lib/api-errors';
import {
  type ApprovedRole,
  type Permission,
  AuthorizationDeniedError,
  requirePermission,
  resolveApprovedRole
} from './authorization';

export class AuthenticationRequiredError extends Error {
  constructor() {
    super('Authentication is required');
    this.name = 'AuthenticationRequiredError';
  }
}

export class OrganizationRequiredError extends Error {
  constructor() {
    super('An active organization is required');
    this.name = 'OrganizationRequiredError';
  }
}

export interface ServerTenantContext {
  userId: string;
  organizationId: string;
}

export interface ServerAuthorizationContext extends ServerTenantContext {
  role: ApprovedRole;
}

type ServerAuthorizationHandler = (
  context: ServerAuthorizationContext
) => Promise<Response> | Response;

export async function requireServerTenantContext(): Promise<ServerTenantContext> {
  const session = await auth();

  if (!session.userId) {
    throw new AuthenticationRequiredError();
  }

  if (!session.orgId) {
    throw new OrganizationRequiredError();
  }

  return {
    userId: session.userId,
    organizationId: session.orgId
  };
}

export async function requireServerAuthorizationContext(): Promise<ServerAuthorizationContext> {
  const session = await auth();

  if (!session.userId) {
    throw new AuthenticationRequiredError();
  }

  if (!session.orgId) {
    throw new OrganizationRequiredError();
  }

  const role = resolveApprovedRole(session.orgRole);

  if (!role) {
    throw new AuthorizationDeniedError();
  }

  return {
    userId: session.userId,
    organizationId: session.orgId,
    role
  };
}

export async function withServerPermission(
  permission: Permission,
  handler: ServerAuthorizationHandler
): Promise<Response> {
  try {
    const context = await requireServerAuthorizationContext();
    requirePermission(context.role, permission);
    return await handler(context);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return apiErrorResponse('AUTHENTICATION_REQUIRED', 401);
    }

    if (error instanceof OrganizationRequiredError) {
      return apiErrorResponse('ORGANIZATION_REQUIRED', 403);
    }

    if (error instanceof AuthorizationDeniedError) {
      return apiErrorResponse('AUTHORIZATION_DENIED', 403);
    }

    throw error;
  }
}
