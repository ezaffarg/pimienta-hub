'use client';

import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { getSortingStateParser } from '@/lib/parsers';
import { listingSyncRunAdminQueryOptions } from '../admin-queries';
import { listingSyncRunColumnIds, listingSyncRunColumns } from './listing-sync-run-columns';

export function ListingSyncRunsTable() {
  const [params] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(10),
    status: parseAsString,
    storeId: parseAsString,
    stale: parseAsString,
    classification: parseAsString,
    sort: getSortingStateParser(new Set(listingSyncRunColumnIds)).withDefault([])
  });
  const filters = {
    page: params.page,
    limit: params.perPage,
    ...(params.status && { status: params.status }),
    ...(params.storeId && { storeId: params.storeId }),
    ...(params.stale && { stale: params.stale as 'true' | 'false' }),
    ...(params.classification && { eligibility: params.classification }),
    ...(params.sort.length > 0 && { sort: JSON.stringify(params.sort) })
  };
  const { data } = useSuspenseQuery(listingSyncRunAdminQueryOptions(filters));
  const columns = useMemo(() => listingSyncRunColumns(data.stores), [data.stores]);
  const pageCount = Math.ceil(data.total / data.limit);
  const { table } = useDataTable({
    data: data.runs,
    columns,
    pageCount,
    shallow: true,
    initialState: { sorting: [{ id: 'startedAt', desc: true }] }
  });

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2'>
      <p className='text-muted-foreground text-xs'>
        Showing the newest {data.scanLimit} runs at most. Times are shown in UTC.
      </p>
      <DataTable
        table={table}
        emptyState={
          <Empty className='border-0 py-8'>
            <EmptyHeader>
              <EmptyTitle>No listing synchronizations yet</EmptyTitle>
              <EmptyDescription>
                Listing sync runs will appear here after their first execution.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      >
        <DataTableToolbar table={table} />
      </DataTable>
    </div>
  );
}
