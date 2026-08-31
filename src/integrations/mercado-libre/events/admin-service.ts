import 'server-only';

import {
  IntegrationEventMaintenanceRepository,
  type IntegrationEventOperationsSummary
} from '@/infrastructure/database/integration-event-maintenance-repository';
import { HubMembershipRepository } from '@/infrastructure/database/repositories';
import { AuthorizationDeniedError, type ApprovedRole } from '@/lib/auth/authorization';
import { requireServerAuthorizationContext } from '@/lib/auth/server-context';

export interface EventOperationsAdminDependencies {
  maintenance?: Pick<IntegrationEventMaintenanceRepository, 'summary'>;
  memberships?: Pick<HubMembershipRepository, 'findByOrganizationAndClerkUser'>;
  context?: () => Promise<{
    userId: string;
    organizationId: string;
    role: ApprovedRole;
    roleSource: 'persistent' | 'clerk-fallback';
  }>;
}

export async function getMercadoLibreEventOperationsSummary(
  dependencies: EventOperationsAdminDependencies = {}
): Promise<IntegrationEventOperationsSummary> {
  const context = await (dependencies.context ?? requireServerAuthorizationContext)();
  if (
    context.roleSource !== 'persistent' ||
    (context.role !== 'Owner' && context.role !== 'Manager')
  ) {
    throw new AuthorizationDeniedError();
  }
  const memberships = dependencies.memberships ?? new HubMembershipRepository();
  const membership = await memberships.findByOrganizationAndClerkUser(
    context.organizationId,
    context.userId
  );
  if (
    !membership ||
    membership.organizationId !== context.organizationId ||
    membership.clerkUserId !== context.userId ||
    membership.role !== context.role
  ) {
    throw new AuthorizationDeniedError();
  }
  return (dependencies.maintenance ?? new IntegrationEventMaintenanceRepository()).summary(
    context.organizationId
  );
}
