import 'server-only';

import {
  HubMembershipRepository,
  StoreAssignmentRepository,
  StoreRepository,
  type StoreAssignment
} from '@/infrastructure/database/repositories';
import { AuthorizationDeniedError } from './authorization';
import { requireServerAuthorizationContext } from './server-context';

type AssignmentResult =
  | { status: 'created'; assignment: StoreAssignment }
  | { status: 'already_assigned'; assignment: StoreAssignment };

interface AssignmentInput {
  membershipId: string;
  storeId: string;
}

function assertAssignmentRole(role: string): void {
  if (role !== 'Employee' && role !== 'Client') {
    throw new AuthorizationDeniedError();
  }
}

async function resolveTarget(
  input: AssignmentInput,
  organizationId: string,
  memberships: Pick<HubMembershipRepository, 'listByOrganization'>,
  stores: Pick<StoreRepository, 'getByOrganizationAndId'>
) {
  const membership = (await memberships.listByOrganization(organizationId)).find(
    (candidate) => candidate.id === input.membershipId
  );
  const store = await stores.getByOrganizationAndId(organizationId, input.storeId);
  if (!membership || !store) throw new AuthorizationDeniedError();
  assertAssignmentRole(membership.role);
  return { membership, store };
}

export async function assignStoreToMembership(
  input: AssignmentInput,
  dependencies: {
    memberships?: Pick<HubMembershipRepository, 'listByOrganization'>;
    stores?: Pick<StoreRepository, 'getByOrganizationAndId'>;
    assignments?: Pick<StoreAssignmentRepository, 'listByMembership' | 'create'>;
  } = {}
): Promise<AssignmentResult> {
  const context = await requireServerAuthorizationContext();
  if (context.role !== 'Owner') throw new AuthorizationDeniedError();
  const memberships = dependencies.memberships ?? new HubMembershipRepository();
  const stores = dependencies.stores ?? new StoreRepository();
  const assignments = dependencies.assignments ?? new StoreAssignmentRepository();
  await resolveTarget(input, context.organizationId, memberships, stores);
  const existing = (
    await assignments.listByMembership(context.organizationId, input.membershipId)
  ).find((assignment) => assignment.storeId === input.storeId);
  if (existing) return { status: 'already_assigned', assignment: existing };
  const assignment = await assignments.create({
    organizationId: context.organizationId,
    membershipId: input.membershipId,
    storeId: input.storeId
  });
  return { status: 'created', assignment };
}

export async function revokeStoreFromMembership(
  input: AssignmentInput,
  dependencies: {
    memberships?: Pick<HubMembershipRepository, 'listByOrganization'>;
    stores?: Pick<StoreRepository, 'getByOrganizationAndId'>;
    assignments?: Pick<StoreAssignmentRepository, 'listByMembership' | 'remove'>;
  } = {}
): Promise<{ status: 'revoked' | 'not_assigned' }> {
  const context = await requireServerAuthorizationContext();
  if (context.role !== 'Owner') throw new AuthorizationDeniedError();
  const memberships = dependencies.memberships ?? new HubMembershipRepository();
  const stores = dependencies.stores ?? new StoreRepository();
  const assignments = dependencies.assignments ?? new StoreAssignmentRepository();
  await resolveTarget(input, context.organizationId, memberships, stores);
  const existing = (
    await assignments.listByMembership(context.organizationId, input.membershipId)
  ).some((assignment) => assignment.storeId === input.storeId);
  if (!existing) return { status: 'not_assigned' };
  await assignments.remove(context.organizationId, input.membershipId, input.storeId);
  return { status: 'revoked' };
}
