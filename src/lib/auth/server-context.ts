import 'server-only';

import { auth } from '@clerk/nextjs/server';

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
