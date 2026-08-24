import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';
import {
  HubMembershipRepository,
  type HubMembership
} from '@/infrastructure/database/repositories';
import { AuthorizationDeniedError, type ApprovedRole } from './authorization';
import { requireServerAuthorizationContext } from './server-context';

export type ProvisionMembershipOutcome =
  | { status: 'created'; membership: HubMembership }
  | { status: 'already_exists'; membership: HubMembership };

export interface ProvisionMembershipInput {
  targetClerkUserId: string;
  role: ApprovedRole;
}

export type OrganizationMembershipChecker = (
  organizationId: string,
  clerkUserId: string
) => Promise<boolean>;

export async function clerkOrganizationMembershipChecker(
  organizationId: string,
  clerkUserId: string
): Promise<boolean> {
  const client = await clerkClient();
  const result = await client.organizations.getOrganizationMembershipList({ organizationId });
  return result.data.some((membership) => membership.publicUserData?.userId === clerkUserId);
}

export async function provisionMembership(
  input: ProvisionMembershipInput,
  dependencies: {
    repository?: Pick<HubMembershipRepository, 'findByOrganizationAndClerkUser' | 'create'>;
    isOrganizationMember?: OrganizationMembershipChecker;
  } = {}
): Promise<ProvisionMembershipOutcome> {
  const context = await requireServerAuthorizationContext();
  if (context.role !== 'Owner') throw new AuthorizationDeniedError();
  if (!input.targetClerkUserId.trim()) throw new AuthorizationDeniedError();

  const isMember = await (dependencies.isOrganizationMember ?? clerkOrganizationMembershipChecker)(
    context.organizationId,
    input.targetClerkUserId
  );
  if (!isMember) throw new AuthorizationDeniedError();

  const repository = dependencies.repository ?? new HubMembershipRepository();
  const existing = await repository.findByOrganizationAndClerkUser(
    context.organizationId,
    input.targetClerkUserId
  );
  if (existing) return { status: 'already_exists', membership: existing };

  const membership = await repository.create({
    organizationId: context.organizationId,
    clerkUserId: input.targetClerkUserId,
    role: input.role
  });
  return { status: 'created', membership };
}
