import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

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

type ServerTenantHandler = (context: ServerTenantContext) => Promise<Response> | Response;

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

export async function withServerTenantContext(handler: ServerTenantHandler): Promise<Response> {
  try {
    return await handler(await requireServerTenantContext());
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

    throw error;
  }
}
