import 'server-only';

import type { HubMembershipRepository } from '@/infrastructure/database/repositories';
import type { ApprovedRole } from './authorization';

export async function resolvePersistentHubRole(
  repository: Pick<HubMembershipRepository, 'findByOrganizationAndClerkUser'>,
  organizationId: string,
  clerkUserId: string
): Promise<ApprovedRole | null> {
  const membership = await repository.findByOrganizationAndClerkUser(organizationId, clerkUserId);
  return membership?.role ?? null;
}
