import { Suspense } from 'react';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import type { SearchParams } from 'nuqs/server';
import PageContainer from '@/components/layout/page-container';
import { DataTableSkeleton } from '@/components/ui/table/data-table-skeleton';
import { getQueryClient } from '@/lib/query-client';
import { listingSyncRunAdminQueryOptions } from '@/integrations/mercado-libre/listings/admin-queries';
import {
  listingSyncRunAdminListQuerySchema,
  listMercadoLibreListingSyncRuns
} from '@/integrations/mercado-libre/listings/recovery-service';
import { ListingSyncRunsTable } from '@/integrations/mercado-libre/listings/components/listing-sync-runs-table';

export const metadata = { title: 'Dashboard: Listing Sync Runs' };

export default async function ListingSyncRunsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const filters = listingSyncRunAdminListQuerySchema.parse({
    page: scalar(raw.page),
    limit: scalar(raw.perPage),
    status: scalar(raw.status),
    storeId: scalar(raw.storeId),
    stale: scalar(raw.stale),
    eligibility: scalar(raw.classification),
    sort: scalar(raw.sort)
  });
  const queryClient = getQueryClient();
  await queryClient.fetchQuery({
    ...listingSyncRunAdminQueryOptions(filters),
    queryFn: () => listMercadoLibreListingSyncRuns(filters)
  });

  return (
    <PageContainer
      pageTitle='Listing Sync Runs'
      pageDescription='Read-only operational history for Mercado Libre listing synchronization.'
    >
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<DataTableSkeleton columnCount={11} rowCount={10} filterCount={4} />}>
          <ListingSyncRunsTable />
        </Suspense>
      </HydrationBoundary>
    </PageContainer>
  );
}

function scalar(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
