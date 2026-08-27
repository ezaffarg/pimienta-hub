'use client';

import type { Column, ColumnDef } from '@tanstack/react-table';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import type { ListingSyncRunAdminReadModel } from '../recovery-service';
import {
  ListingSyncRunEligibilityBadge,
  ListingSyncRunProgress,
  ListingSyncRunSafeError,
  ListingSyncRunStaleBadge,
  ListingSyncRunStatusBadge,
  ListingSyncRunTimestamp
} from './listing-sync-run-cells';
import { ListingSyncRunRecoveryAction } from './listing-sync-run-recovery-action';

export const listingSyncRunColumnIds = [
  'status',
  'storeId',
  'connection',
  'startedAt',
  'lastCheckpointAt',
  'completedAt',
  'progress',
  'stale',
  'classification',
  'error'
] as const;

export function listingSyncRunColumns(
  stores: { id: string; name: string }[]
): ColumnDef<ListingSyncRunAdminReadModel>[] {
  return [
    {
      id: 'status',
      accessorKey: 'status',
      header: ({ column }: { column: Column<ListingSyncRunAdminReadModel, unknown> }) => (
        <DataTableColumnHeader column={column} title='Status' />
      ),
      cell: ({ row }) => <ListingSyncRunStatusBadge status={row.original.status} />,
      enableColumnFilter: true,
      meta: {
        label: 'Status',
        variant: 'multiSelect' as const,
        options: ['running', 'succeeded', 'partial', 'failed'].map((status) => ({
          label: status,
          value: status
        }))
      }
    },
    {
      id: 'storeId',
      accessorFn: (run) => run.storeName,
      header: 'Store',
      cell: ({ row }) => <span className='font-medium'>{row.original.storeName}</span>,
      enableSorting: false,
      enableColumnFilter: true,
      meta: {
        label: 'Store',
        variant: 'multiSelect' as const,
        options: stores.map((store) => ({ label: store.name, value: store.id }))
      }
    },
    {
      id: 'connection',
      header: 'Connection',
      enableSorting: false,
      cell: ({ row }) => (
        <div className='flex max-w-48 flex-col gap-0.5 whitespace-normal'>
          <span>Mercado Libre</span>
          <span className='text-muted-foreground break-words text-xs'>
            {row.original.connectionExternalAccountId ?? 'Account unavailable'}
          </span>
        </div>
      )
    },
    {
      id: 'startedAt',
      accessorKey: 'startedAt',
      header: ({ column }: { column: Column<ListingSyncRunAdminReadModel, unknown> }) => (
        <DataTableColumnHeader column={column} title='Started' />
      ),
      cell: ({ row }) => <ListingSyncRunTimestamp value={row.original.startedAt} />
    },
    {
      id: 'lastCheckpointAt',
      accessorKey: 'lastCheckpointAt',
      header: ({ column }: { column: Column<ListingSyncRunAdminReadModel, unknown> }) => (
        <DataTableColumnHeader column={column} title='Last checkpoint' />
      ),
      cell: ({ row }) => <ListingSyncRunTimestamp value={row.original.lastCheckpointAt} />
    },
    {
      id: 'completedAt',
      accessorKey: 'completedAt',
      header: ({ column }: { column: Column<ListingSyncRunAdminReadModel, unknown> }) => (
        <DataTableColumnHeader column={column} title='Completed' />
      ),
      cell: ({ row }) => <ListingSyncRunTimestamp value={row.original.completedAt} />
    },
    {
      id: 'progress',
      header: 'Progress',
      enableSorting: false,
      cell: ({ row }) => <ListingSyncRunProgress run={row.original} />
    },
    {
      id: 'stale',
      accessorFn: (run) => String(run.stale),
      header: 'Run state',
      enableSorting: false,
      cell: ({ row }) => <ListingSyncRunStaleBadge run={row.original} />,
      enableColumnFilter: true,
      meta: {
        label: 'Run state',
        variant: 'select' as const,
        options: [
          { label: 'Stale', value: 'true' },
          { label: 'Not stale', value: 'false' }
        ]
      }
    },
    {
      id: 'classification',
      accessorKey: 'classification',
      header: 'Eligibility',
      enableSorting: false,
      cell: ({ row }) => (
        <ListingSyncRunEligibilityBadge classification={row.original.classification} />
      ),
      enableColumnFilter: true,
      meta: {
        label: 'Eligibility',
        variant: 'multiSelect' as const,
        options: [
          { label: 'Recover as succeeded', value: 'RECOVERABLE_AS_SUCCEEDED' },
          { label: 'Mark failed', value: 'RECOVERABLE_AS_FAILED' },
          { label: 'Not recoverable', value: 'NOT_RECOVERABLE' },
          { label: 'Not stale', value: 'NOT_STALE' }
        ]
      }
    },
    {
      id: 'error',
      header: 'Error',
      enableSorting: false,
      cell: ({ row }) => <ListingSyncRunSafeError run={row.original} />
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => <ListingSyncRunRecoveryAction run={row.original} />
    }
  ];
}
