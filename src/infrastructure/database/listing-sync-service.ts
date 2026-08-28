import 'server-only';

import { z } from 'zod';
import type { ExternalListingSummary } from '@/integrations/core';
import { ListingRepository, type ListingRecord, type ListingScope } from './repositories';

export class ListingSyncService {
  constructor(private readonly listings = new ListingRepository()) {}

  async syncAuthorizedConnection(input: {
    scope: ListingScope;
    summaries: readonly ExternalListingSummary[];
    syncedAt?: string;
  }): Promise<ListingRecord[]> {
    const scope = z
      .object({
        organizationId: z.string().trim().min(1).max(255),
        storeId: z.uuid(),
        connectionId: z.uuid()
      })
      .parse(input.scope);
    const syncedAt = input.syncedAt ?? new Date().toISOString();
    return this.listings.upsertMany(scope, input.summaries, syncedAt);
  }

  async syncAuthorizedRun(input: {
    scope: ListingScope;
    runId: string;
    summaries: readonly ExternalListingSummary[];
    syncedAt?: string;
  }): Promise<ListingRecord[]> {
    const scope = z
      .object({
        organizationId: z.string().trim().min(1).max(255),
        storeId: z.uuid(),
        connectionId: z.uuid()
      })
      .parse(input.scope);
    const runId = z.uuid().parse(input.runId);
    const syncedAt = input.syncedAt ?? new Date().toISOString();
    return this.listings.upsertManyForRun(scope, runId, input.summaries, syncedAt);
  }
}
