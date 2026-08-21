import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
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
      return NextResponse.json(
        {
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: error.message
          }
        },
        { status: 401 }
      );
    }

    if (error instanceof OrganizationRequiredError) {
      return NextResponse.json(
        {
          error: {
            code: 'ORGANIZATION_REQUIRED',
            message: error.message
          }
        },
        { status: 403 }
      );
    }

    if (error instanceof AuthorizationDeniedError) {
      return NextResponse.json(
        {
          error: {
            code: 'AUTHORIZATION_DENIED',
            message: error.message
          }
        },
        { status: 403 }
      );
    }

    throw error;
  }
}
