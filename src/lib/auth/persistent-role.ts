import 'server-only';

import type { HubMembershipRepository } from '@/infrastructure/database/repositories';
import { APPROVED_ROLES, resolveApprovedRole, type ApprovedRole } from './authorization';

export type HubRoleSource = 'persistent' | 'clerk-fallback';

export interface ResolvedHubRole {
  role: ApprovedRole;
  source: HubRoleSource;
}

export async function resolvePersistentHubRole(
  repository: Pick<HubMembershipRepository, 'findByOrganizationAndClerkUser'>,
  organizationId: string,
  clerkUserId: string
): Promise<ApprovedRole | null> {
  const membership = await repository.findByOrganizationAndClerkUser(organizationId, clerkUserId);
  return isValidMembership(membership, organizationId, clerkUserId) ? membership.role : null;
}

export async function resolveHubRole(
  repository: Pick<HubMembershipRepository, 'findByOrganizationAndClerkUser'>,
  organizationId: string,
  clerkUserId: string,
  clerkRole: string | null | undefined
): Promise<ResolvedHubRole | null> {
  const membership = await repository.findByOrganizationAndClerkUser(organizationId, clerkUserId);

  if (membership) {
    return isValidMembership(membership, organizationId, clerkUserId)
      ? { role: membership.role, source: 'persistent' }
      : null;
  }

  const fallbackRole = resolveApprovedRole(clerkRole);
  return fallbackRole ? { role: fallbackRole, source: 'clerk-fallback' } : null;
}

function isValidMembership(
  membership: Awaited<ReturnType<HubMembershipRepository['findByOrganizationAndClerkUser']>>,
  organizationId: string,
  clerkUserId: string
): membership is NonNullable<typeof membership> {
  return Boolean(
    membership &&
    membership.organizationId === organizationId &&
    membership.clerkUserId === clerkUserId &&
    APPROVED_ROLES.includes(membership.role)
  );
}
