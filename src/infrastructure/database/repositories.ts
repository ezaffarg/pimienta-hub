import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApprovedRole } from '@/lib/auth/authorization';
import type { IntegrationProvider } from '@/integrations/core';
import { getSupabaseServerClient } from './supabase-server';

export interface HubMembership {
  id: string;
  organizationId: string;
  clerkUserId: string;
  role: ApprovedRole;
}

export type BootstrapFirstOwnerOutcome =
  | 'created'
  | 'already_bootstrapped'
  | 'membership_exists_non_owner';

export interface StoreRecord {
  id: string;
  organizationId: string;
  name: string;
  status: 'active' | 'disabled';
}

export type CreateStoreInput = Omit<StoreRecord, 'id' | 'organizationId'>;

export interface StoreAssignment {
  membershipId: string;
  storeId: string;
  organizationId: string;
}

export interface ConnectionRecord {
  id: string;
  organizationId: string;
  storeId: string;
  provider: IntegrationProvider;
  externalAccountId: string | null;
  status: 'active' | 'disabled';
  scopes: string[];
  expiresAt: string | null;
}

export interface CreateConnectionInput {
  storeId: string;
  provider: IntegrationProvider;
  externalAccountId?: string | null;
  status?: ConnectionRecord['status'];
  scopes?: string[];
  expiresAt?: string | null;
}

export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

function throwOnError(error: { message: string } | null): void {
  if (error) {
    throw new PersistenceError(error.message);
  }
}

function requireData<T>(data: T | null, error: { message: string } | null): T {
  throwOnError(error);
  if (data === null) {
    throw new PersistenceError('The persistence operation did not return data');
  }

  return data;
}

export class HubMembershipRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServerClient()) {}

  async findByOrganizationAndClerkUser(
    organizationId: string,
    clerkUserId: string
  ): Promise<HubMembership | null> {
    const { data, error } = await this.client
      .from('hub_memberships')
      .select('id, organization_id, clerk_user_id, role')
      .eq('organization_id', organizationId)
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();

    throwOnError(error);
    if (!data) return null;

    return {
      id: data.id,
      organizationId: data.organization_id,
      clerkUserId: data.clerk_user_id,
      role: data.role as ApprovedRole
    };
  }

  async hasOwner(organizationId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('hub_memberships')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('role', 'Owner')
      .limit(1);

    throwOnError(error);
    return (data ?? []).length > 0;
  }

  async create(input: Omit<HubMembership, 'id'>): Promise<HubMembership> {
    const { data, error } = await this.client
      .from('hub_memberships')
      .insert({
        organization_id: input.organizationId,
        clerk_user_id: input.clerkUserId,
        role: input.role
      })
      .select('id, organization_id, clerk_user_id, role')
      .single();

    const record = requireData(data, error);
    return {
      id: record.id,
      organizationId: record.organization_id,
      clerkUserId: record.clerk_user_id,
      role: record.role as ApprovedRole
    };
  }

  async listByOrganization(organizationId: string): Promise<HubMembership[]> {
    const { data, error } = await this.client
      .from('hub_memberships')
      .select('id, organization_id, clerk_user_id, role')
      .eq('organization_id', organizationId);
    return requireData(data, error).map((record) => ({
      id: record.id,
      organizationId: record.organization_id,
      clerkUserId: record.clerk_user_id,
      role: record.role as ApprovedRole
    }));
  }

  async bootstrapFirstOwner(
    organizationId: string,
    clerkUserId: string
  ): Promise<{ outcome: BootstrapFirstOwnerOutcome; membershipId: string }> {
    const { data, error } = await this.client.rpc('bootstrap_first_owner', {
      p_organization_id: organizationId,
      p_clerk_user_id: clerkUserId
    });
    const record = requireData(data?.[0] ?? null, error);
    return {
      outcome: record.outcome as BootstrapFirstOwnerOutcome,
      membershipId: record.membership_id
    };
  }
}

export class StoreRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServerClient()) {}

  async listByOrganization(organizationId: string): Promise<StoreRecord[]> {
    const { data, error } = await this.client
      .from('stores')
      .select('id, organization_id, name, status')
      .eq('organization_id', organizationId);

    return requireData(data, error).map((store) => ({
      id: store.id,
      organizationId: store.organization_id,
      name: store.name,
      status: store.status as StoreRecord['status']
    }));
  }

  async listByOrganizationAndIds(
    organizationId: string,
    storeIds: readonly string[]
  ): Promise<StoreRecord[]> {
    if (storeIds.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from('stores')
      .select('id, organization_id, name, status')
      .eq('organization_id', organizationId)
      .in('id', storeIds);

    return requireData(data, error).map((store) => ({
      id: store.id,
      organizationId: store.organization_id,
      name: store.name,
      status: store.status as StoreRecord['status']
    }));
  }

  async getByOrganizationAndId(
    organizationId: string,
    storeId: string
  ): Promise<StoreRecord | null> {
    const { data, error } = await this.client
      .from('stores')
      .select('id, organization_id, name, status')
      .eq('organization_id', organizationId)
      .eq('id', storeId)
      .maybeSingle();

    throwOnError(error);
    if (!data) return null;

    return {
      id: data.id,
      organizationId: data.organization_id,
      name: data.name,
      status: data.status as StoreRecord['status']
    };
  }

  async create(organizationId: string, input: CreateStoreInput): Promise<StoreRecord> {
    const { data, error } = await this.client
      .from('stores')
      .insert({ organization_id: organizationId, name: input.name, status: input.status })
      .select('id, organization_id, name, status')
      .single();

    const record = requireData(data, error);
    return {
      id: record.id,
      organizationId: record.organization_id,
      name: record.name,
      status: record.status as StoreRecord['status']
    };
  }
}

export class StoreAssignmentRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServerClient()) {}

  async listByMembership(organizationId: string, membershipId: string): Promise<StoreAssignment[]> {
    const { data, error } = await this.client
      .from('store_assignments')
      .select('membership_id, store_id, organization_id')
      .eq('organization_id', organizationId)
      .eq('membership_id', membershipId);

    return requireData(data, error).map((assignment) => ({
      membershipId: assignment.membership_id,
      storeId: assignment.store_id,
      organizationId: assignment.organization_id
    }));
  }

  async create(input: StoreAssignment): Promise<StoreAssignment> {
    const { data, error } = await this.client
      .from('store_assignments')
      .insert({
        membership_id: input.membershipId,
        store_id: input.storeId,
        organization_id: input.organizationId
      })
      .select('membership_id, store_id, organization_id')
      .single();

    const record = requireData(data, error);
    return {
      membershipId: record.membership_id,
      storeId: record.store_id,
      organizationId: record.organization_id
    };
  }

  async remove(organizationId: string, membershipId: string, storeId: string): Promise<boolean> {
    const { error, count } = await this.client
      .from('store_assignments')
      .delete({ count: 'exact' })
      .eq('organization_id', organizationId)
      .eq('membership_id', membershipId)
      .eq('store_id', storeId);
    throwOnError(error);
    return (count ?? 0) > 0;
  }
}

export class ConnectionRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServerClient()) {}

  async listByStore(organizationId: string, storeId: string): Promise<ConnectionRecord[]> {
    const { data, error } = await this.client
      .from('connections')
      .select(
        'id, organization_id, store_id, provider, external_account_id, status, scopes, expires_at'
      )
      .eq('organization_id', organizationId)
      .eq('store_id', storeId);
    return requireData(data, error).map(connectionRecord);
  }

  async getById(organizationId: string, connectionId: string): Promise<ConnectionRecord | null> {
    const { data, error } = await this.client
      .from('connections')
      .select(
        'id, organization_id, store_id, provider, external_account_id, status, scopes, expires_at'
      )
      .eq('organization_id', organizationId)
      .eq('id', connectionId)
      .maybeSingle();
    throwOnError(error);
    return data ? connectionRecord(data) : null;
  }

  async create(organizationId: string, input: CreateConnectionInput): Promise<ConnectionRecord> {
    const { data, error } = await this.client
      .from('connections')
      .insert({
        organization_id: organizationId,
        store_id: input.storeId,
        provider: input.provider,
        external_account_id: input.externalAccountId ?? null,
        status: input.status ?? 'disabled',
        scopes: input.scopes ?? [],
        expires_at: input.expiresAt ?? null
      })
      .select(
        'id, organization_id, store_id, provider, external_account_id, status, scopes, expires_at'
      )
      .single();
    return connectionRecord(requireData(data, error));
  }
}

function connectionRecord(record: {
  id: string;
  organization_id: string;
  store_id: string;
  provider: string;
  external_account_id: string | null;
  status: string;
  scopes: string[];
  expires_at: string | null;
}): ConnectionRecord {
  return {
    id: record.id,
    organizationId: record.organization_id,
    storeId: record.store_id,
    provider: record.provider as IntegrationProvider,
    externalAccountId: record.external_account_id,
    status: record.status as ConnectionRecord['status'],
    scopes: record.scopes,
    expiresAt: record.expires_at
  };
}
