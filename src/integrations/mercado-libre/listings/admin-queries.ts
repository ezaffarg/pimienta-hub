import { mutationOptions, queryOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getQueryClient } from '@/lib/query-client';
import type {
  ListingSyncRunAdminListQuery,
  ListingSyncRunAdminListResponse
} from './recovery-service';

export const listingSyncRunAdminKeys = {
  all: ['listing-sync-runs', 'admin'] as const,
  list: (filters: ListingSyncRunAdminListQuery) =>
    [...listingSyncRunAdminKeys.all, 'list', filters] as const
};

export const listingSyncRunAdminQueryOptions = (filters: ListingSyncRunAdminListQuery) =>
  queryOptions({
    queryKey: listingSyncRunAdminKeys.list(filters),
    queryFn: () => getListingSyncRuns(filters)
  });

export type ListingSyncRunRecoveryMutationInput = {
  runId: string;
  terminalStatus: 'succeeded' | 'failed';
  reason: 'FINALIZE_INTERRUPTED' | 'PROCESS_CRASHED' | 'MANUAL_ABORT' | 'UNKNOWN_EXECUTION_STATE';
};

export type ListingSyncRunRecoveryMutationResult = {
  outcome: 'recovered' | 'already_terminal' | 'not_stale' | 'not_recoverable';
};

export const listingSyncRunRecoveryMutation = mutationOptions({
  mutationFn: recoverListingSyncRun,
  onSuccess: () => getQueryClient().invalidateQueries({ queryKey: listingSyncRunAdminKeys.all })
});

export async function recoverListingSyncRun({
  runId,
  ...body
}: ListingSyncRunRecoveryMutationInput): Promise<ListingSyncRunRecoveryMutationResult> {
  return apiClient<ListingSyncRunRecoveryMutationResult>(
    `/integrations/mercado-libre/listing-sync-runs/${runId}/recovery`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

async function getListingSyncRuns(
  filters: ListingSyncRunAdminListQuery
): Promise<ListingSyncRunAdminListResponse> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return apiClient<ListingSyncRunAdminListResponse>(
    `/integrations/mercado-libre/listing-sync-runs?${search}`
  );
}
