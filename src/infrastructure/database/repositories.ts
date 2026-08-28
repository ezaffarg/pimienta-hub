import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ApprovedRole } from '@/lib/auth/authorization';
import type { ExternalListingSummary, IntegrationProvider } from '@/integrations/core';
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

export interface ListingScope {
  organizationId: string;
  storeId: string;
  connectionId: string;
}

export interface ListingRecord extends ListingScope {
  id: string;
  externalListingId: string;
  title: string;
  status: string;
  price: string | null;
  currencyId: string | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  sellerSku: string | null;
  listingTypeId: string | null;
  condition: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  catalogProductId: string | null;
  providerCreatedAt: string | null;
  providerUpdatedAt: string | null;
  lastSyncedAt: string;
  lastSeenSyncRunId: string | null;
  reconciliationState: 'seen' | 'missing_candidate';
  notSeenSince: string | null;
  consecutiveNotSeenCount: number;
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

  async listByOrganizationAndIds(
    organizationId: string,
    connectionIds: readonly string[]
  ): Promise<ConnectionRecord[]> {
    if (connectionIds.length === 0) return [];

    const { data, error } = await this.client
      .from('connections')
      .select(
        'id, organization_id, store_id, provider, external_account_id, status, scopes, expires_at'
      )
      .eq('organization_id', organizationId)
      .in('id', connectionIds);
    return requireData(data, error).map(connectionRecord);
  }

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

  async findByProviderAndExternalAccount(
    provider: IntegrationProvider,
    externalAccountId: string
  ): Promise<ConnectionRecord | null> {
    const { data, error } = await this.client
      .from('connections')
      .select(
        'id, organization_id, store_id, provider, external_account_id, status, scopes, expires_at'
      )
      .eq('provider', provider)
      .eq('external_account_id', externalAccountId)
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

export class ListingRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServerClient()) {}

  async upsertMany(
    scope: ListingScope,
    listings: readonly ExternalListingSummary[],
    lastSyncedAt: string
  ): Promise<ListingRecord[]> {
    const parsedScope = listingScopeSchema.parse(scope);
    const syncedAt = z.iso.datetime().parse(lastSyncedAt);
    if (listings.length === 0) return [];

    const { data: connection, error: connectionError } = await this.client
      .from('connections')
      .select('id')
      .eq('id', parsedScope.connectionId)
      .eq('organization_id', parsedScope.organizationId)
      .eq('store_id', parsedScope.storeId)
      .maybeSingle();
    throwOnError(connectionError);
    if (!connection) throw new PersistenceError('Listing scope does not match a connection');

    const rows = listings.map((listing) => listingRow(parsedScope, listing, syncedAt));
    const { data, error } = await this.client
      .from('listings')
      .upsert(rows, { onConflict: 'connection_id,external_listing_id' })
      .select(listingColumns);
    return requireData(data, error).map(listingRecord);
  }

  async upsertManyForRun(
    scope: ListingScope,
    runId: string,
    listings: readonly ExternalListingSummary[],
    lastSyncedAt: string
  ): Promise<ListingRecord[]> {
    const parsedScope = listingScopeSchema.parse(scope);
    const parsedRunId = z.uuid().parse(runId);
    const syncedAt = z.iso.datetime().parse(lastSyncedAt);
    if (listings.length === 0) return [];

    const rows = listings.map((listing) => listingRow(parsedScope, listing, syncedAt));
    const { data, error } = await this.client.rpc('persist_listing_sync_batch_for_run', {
      p_organization_id: parsedScope.organizationId,
      p_store_id: parsedScope.storeId,
      p_connection_id: parsedScope.connectionId,
      p_run_id: parsedRunId,
      p_synced_at: syncedAt,
      p_listings: rows
    });
    return requireData(data, error).map(listingRecord);
  }

  async findByStore(organizationId: string, storeId: string): Promise<ListingRecord[]> {
    const scope = z
      .object({ organizationId: z.string().min(1).max(255), storeId: z.uuid() })
      .parse({
        organizationId,
        storeId
      });
    const { data, error } = await this.client
      .from('listings')
      .select(listingColumns)
      .eq('organization_id', scope.organizationId)
      .eq('store_id', scope.storeId);
    return requireData(data, error).map(listingRecord);
  }

  async findByConnection(scope: ListingScope): Promise<ListingRecord[]> {
    const parsedScope = listingScopeSchema.parse(scope);
    const { data, error } = await this.client
      .from('listings')
      .select(listingColumns)
      .eq('organization_id', parsedScope.organizationId)
      .eq('store_id', parsedScope.storeId)
      .eq('connection_id', parsedScope.connectionId);
    return requireData(data, error).map(listingRecord);
  }

  async countByStore(organizationId: string, storeId: string): Promise<number> {
    const scope = z
      .object({ organizationId: z.string().min(1).max(255), storeId: z.uuid() })
      .parse({
        organizationId,
        storeId
      });
    const { count, error } = await this.client
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', scope.organizationId)
      .eq('store_id', scope.storeId);
    throwOnError(error);
    return count ?? 0;
  }
}

const listingScopeSchema = z.object({
  organizationId: z.string().trim().min(1).max(255),
  storeId: z.uuid(),
  connectionId: z.uuid()
});

const listingColumns =
  'id, organization_id, store_id, connection_id, external_listing_id, title, status, price, currency_id, available_quantity, sold_quantity, seller_sku, listing_type_id, condition, permalink, thumbnail_url, catalog_product_id, provider_created_at, provider_updated_at, last_synced_at, last_seen_sync_run_id, reconciliation_state, not_seen_since, consecutive_not_seen_count';

function listingRow(scope: ListingScope, listing: ExternalListingSummary, lastSyncedAt: string) {
  const value = z
    .object({
      externalId: z.string().trim().min(1).max(255),
      title: z.string().trim().min(1).max(500),
      status: z.string().trim().min(1).max(100),
      price: z.number().finite().nonnegative().nullable(),
      currency: z.string().trim().min(1).max(16).nullable(),
      availableQuantity: z.number().int().nonnegative().nullable(),
      soldQuantity: z.number().int().nonnegative().nullable(),
      sellerSku: z.string().trim().min(1).max(255).nullable(),
      listingType: z.string().trim().min(1).max(100).nullable(),
      condition: z.string().trim().min(1).max(100).nullable(),
      permalink: z.url().max(2048).nullable(),
      thumbnail: z.url().max(2048).nullable(),
      catalogProductId: z.string().trim().min(1).max(255).nullable(),
      providerCreatedAt: z.iso.datetime().nullable(),
      providerUpdatedAt: z.iso.datetime().nullable()
    })
    .parse(listing);
  return {
    organization_id: scope.organizationId,
    store_id: scope.storeId,
    connection_id: scope.connectionId,
    external_listing_id: value.externalId,
    title: value.title,
    status: value.status,
    price: value.price === null ? null : String(value.price),
    currency_id: value.currency,
    available_quantity: value.availableQuantity,
    sold_quantity: value.soldQuantity,
    seller_sku: value.sellerSku,
    listing_type_id: value.listingType,
    condition: value.condition,
    permalink: value.permalink,
    thumbnail_url: value.thumbnail,
    catalog_product_id: value.catalogProductId,
    provider_created_at: value.providerCreatedAt,
    provider_updated_at: value.providerUpdatedAt,
    last_synced_at: lastSyncedAt,
    updated_at: lastSyncedAt
  };
}

function listingRecord(record: {
  id: string;
  organization_id: string;
  store_id: string;
  connection_id: string;
  external_listing_id: string;
  title: string;
  status: string;
  price: string | number | null;
  currency_id: string | null;
  available_quantity: number | null;
  sold_quantity: number | null;
  seller_sku: string | null;
  listing_type_id: string | null;
  condition: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  catalog_product_id: string | null;
  provider_created_at: string | null;
  provider_updated_at: string | null;
  last_synced_at: string;
  last_seen_sync_run_id: string | null;
  reconciliation_state: string;
  not_seen_since: string | null;
  consecutive_not_seen_count: number;
}): ListingRecord {
  return {
    id: record.id,
    organizationId: record.organization_id,
    storeId: record.store_id,
    connectionId: record.connection_id,
    externalListingId: record.external_listing_id,
    title: record.title,
    status: record.status,
    price: record.price === null ? null : String(record.price),
    currencyId: record.currency_id,
    availableQuantity: record.available_quantity,
    soldQuantity: record.sold_quantity,
    sellerSku: record.seller_sku,
    listingTypeId: record.listing_type_id,
    condition: record.condition,
    permalink: record.permalink,
    thumbnailUrl: record.thumbnail_url,
    catalogProductId: record.catalog_product_id,
    providerCreatedAt: record.provider_created_at,
    providerUpdatedAt: record.provider_updated_at,
    lastSyncedAt: record.last_synced_at,
    lastSeenSyncRunId: z.uuid().nullable().parse(record.last_seen_sync_run_id),
    reconciliationState: z.enum(['seen', 'missing_candidate']).parse(record.reconciliation_state),
    notSeenSince: z.iso.datetime({ offset: true }).nullable().parse(record.not_seen_since),
    consecutiveNotSeenCount: z.number().int().nonnegative().parse(record.consecutive_not_seen_count)
  };
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
