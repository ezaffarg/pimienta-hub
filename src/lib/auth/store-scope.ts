import 'server-only';

import type {
  HubMembership,
  StoreAssignmentRepository,
  StoreRecord,
  StoreRepository
} from '@/infrastructure/database/repositories';

export interface StoreScopeContext {
  organizationId: string;
  membership: HubMembership | null;
}

export interface AllStoresScope {
  kind: 'all-stores';
}

export interface AssignedStoresScope {
  kind: 'assigned-stores';
  storeIds: ReadonlySet<string>;
}

export type StoreScope = AllStoresScope | AssignedStoresScope;

export async function resolveStoreScope(
  context: StoreScopeContext,
  assignmentRepository: Pick<StoreAssignmentRepository, 'listByMembership'>
): Promise<StoreScope> {
  const membership = context.membership;

  if (!membership || membership.organizationId !== context.organizationId) {
    return { kind: 'assigned-stores', storeIds: new Set() };
  }

  if (membership.role === 'Owner' || membership.role === 'Manager') {
    return { kind: 'all-stores' };
  }

  if (membership.role !== 'Employee' && membership.role !== 'Client') {
    return { kind: 'assigned-stores', storeIds: new Set() };
  }

  const assignments = await assignmentRepository.listByMembership(
    context.organizationId,
    membership.id
  );

  return {
    kind: 'assigned-stores',
    storeIds: new Set(
      assignments
        .filter((assignment) => assignment.organizationId === context.organizationId)
        .map((assignment) => assignment.storeId)
    )
  };
}

export function canAccessStore(
  scope: StoreScope,
  organizationId: string,
  store: Pick<StoreRecord, 'id' | 'organizationId'>
): boolean {
  if (store.organizationId !== organizationId) {
    return false;
  }

  return scope.kind === 'all-stores' || scope.storeIds.has(store.id);
}

export async function listStoresWithinScope(
  scope: StoreScope,
  organizationId: string,
  storeRepository: Pick<StoreRepository, 'listByOrganization' | 'listByOrganizationAndIds'>
): Promise<StoreRecord[]> {
  if (scope.kind === 'all-stores') {
    const stores = await storeRepository.listByOrganization(organizationId);
    return stores.filter((store) => store.organizationId === organizationId);
  }

  const stores = await storeRepository.listByOrganizationAndIds(organizationId, [
    ...scope.storeIds
  ]);
  return stores.filter(
    (store) => store.organizationId === organizationId && scope.storeIds.has(store.id)
  );
}
