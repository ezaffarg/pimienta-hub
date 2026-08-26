import 'server-only';

import { z } from 'zod';
import { ListingSyncService } from '@/infrastructure/database/listing-sync-service';
import { ConnectionRepository, type ListingScope } from '@/infrastructure/database/repositories';
import { MercadoLibreCredentialService } from '../auth';
import {
  MercadoLibreListingsClient,
  MercadoLibreListingsError,
  type MercadoLibreListingDiscoveryCursor,
  type MercadoLibreListingFailure,
  type MercadoLibreListingPage
} from './client';

const DETAIL_CHUNK_SIZE = 20;
const MAX_DISCOVERY_PAGES = 10_000;

export class MercadoLibreListingsServiceError extends Error {
  constructor(
    public readonly kind:
      | 'connection_not_found'
      | 'connection_not_active'
      | 'connection_binding_invalid'
      | 'credentials_not_found'
  ) {
    super(kind);
    this.name = 'MercadoLibreListingsServiceError';
  }
}

export interface MercadoLibreListingBackfillProgress {
  discovered: number;
  requested: number;
  fetched: number;
  persisted: number;
  failed: number;
  pages: number;
  batches: number;
}

export interface MercadoLibreListingBackfillResult extends MercadoLibreListingBackfillProgress {
  failures: readonly MercadoLibreListingFailure[];
}

export type MercadoLibreListingProgressCallback = (
  progress: MercadoLibreListingBackfillProgress
) => Promise<void>;

export class MercadoLibreListingsService {
  constructor(
    private readonly connections = new ConnectionRepository(),
    private readonly credentials = new MercadoLibreCredentialService(),
    private readonly listings = new MercadoLibreListingsClient(),
    private readonly sync?: ListingSyncService
  ) {}

  async listActiveConnectionListings(input: {
    organizationId: string;
    storeId: string;
    connectionId: string;
    limit?: number;
  }): Promise<MercadoLibreListingPage> {
    const parsed = listingInputSchema.parse(input);
    const runtime = await this.getRuntime(parsed);
    return this.listings.listSellerListings({
      accessToken: runtime.accessToken,
      sellerId: runtime.externalAccountId,
      limit: parsed.limit ?? 20
    });
  }

  async syncAllActiveConnectionListings(
    input: {
      organizationId: string;
      storeId: string;
      connectionId: string;
    },
    onProgress?: MercadoLibreListingProgressCallback
  ): Promise<MercadoLibreListingBackfillResult> {
    const parsed = listingInputSchema.omit({ limit: true }).parse(input);
    const runtime = await this.getRuntime(parsed);
    const accessToken = runtime.accessToken;
    const sync = this.sync ?? new ListingSyncService();
    const scope: ListingScope = parsed;
    const discoveredIds = new Set<string>();
    const seenCursors = new Set<string>();
    const failures: MercadoLibreListingFailure[] = [];
    let cursor: MercadoLibreListingDiscoveryCursor | null = null;
    let requested = 0;
    let fetched = 0;
    let persisted = 0;
    let pages = 0;
    let batches = 0;

    const reportProgress = async (): Promise<void> => {
      await onProgress?.({
        discovered: discoveredIds.size,
        requested,
        fetched,
        persisted,
        failed: failures.length,
        pages,
        batches
      });
    };

    do {
      if (pages >= MAX_DISCOVERY_PAGES) {
        throw new MercadoLibreListingsError('invalid_provider_response', 'discovery', false);
      }
      const page = await this.listings.discoverSellerListingIds({
        accessToken,
        sellerId: runtime.externalAccountId,
        cursor
      });
      const newIds = page.itemIds.filter((itemId) => {
        if (discoveredIds.has(itemId)) return false;
        discoveredIds.add(itemId);
        return true;
      });

      for (let start = 0; start < newIds.length; start += DETAIL_CHUNK_SIZE) {
        const itemIds = newIds.slice(start, start + DETAIL_CHUNK_SIZE);
        requested += itemIds.length;
        let details;
        try {
          details = await this.listings.getListingDetails({
            accessToken,
            itemIds
          });
        } catch (error) {
          if (!(error instanceof MercadoLibreListingsError)) throw error;
          failures.push(
            ...itemIds.map((externalListingId) => ({
              externalListingId,
              kind: error.kind,
              retryable: error.retryable,
              status: error.status
            }))
          );
          batches += 1;
          await reportProgress();
          continue;
        }

        fetched += details.items.length;
        failures.push(...details.failures);
        if (details.items.length > 0) {
          const records = await sync.syncAuthorizedConnection({
            scope,
            summaries: details.items
          });
          persisted += records.length;
        }
        batches += 1;
        await reportProgress();
      }

      pages += 1;
      await reportProgress();
      cursor = page.nextCursor;
      if (cursor?.mode === 'offset') {
        const cursorKey = JSON.stringify(cursor);
        if (seenCursors.has(cursorKey)) {
          throw new MercadoLibreListingsError('invalid_provider_response', 'discovery', false);
        }
        seenCursors.add(cursorKey);
      }
    } while (cursor);

    return {
      discovered: discoveredIds.size,
      requested,
      fetched,
      persisted,
      failed: failures.length,
      pages,
      batches,
      failures
    };
  }

  private async getRuntime(input: ListingScope): Promise<{
    accessToken: string;
    externalAccountId: string;
  }> {
    const connection = await this.connections.getById(input.organizationId, input.connectionId);
    if (!connection) throw new MercadoLibreListingsServiceError('connection_not_found');
    if (connection.status !== 'active') {
      throw new MercadoLibreListingsServiceError('connection_not_active');
    }
    if (
      connection.organizationId !== input.organizationId ||
      connection.storeId !== input.storeId ||
      connection.provider !== 'mercado-libre' ||
      !connection.externalAccountId
    ) {
      throw new MercadoLibreListingsServiceError('connection_binding_invalid');
    }

    const accessToken = await this.credentials.getValidAccessToken({
      organizationId: input.organizationId,
      connectionId: input.connectionId
    });
    return { accessToken, externalAccountId: connection.externalAccountId };
  }
}

const listingInputSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    storeId: z.uuid(),
    connectionId: z.uuid(),
    limit: z.number().int().min(1).max(20).optional()
  })
  .strict();
