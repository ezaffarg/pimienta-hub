import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, type MutationFunctionContext } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));

vi.mock('@/lib/query-client', () => ({
  getQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries })
}));

import {
  listingSyncRunAdminKeys,
  listingSyncRunRecoveryMutation,
  recoverListingSyncRun,
  type ListingSyncRunRecoveryMutationInput,
  type ListingSyncRunRecoveryMutationResult
} from './admin-queries';

const input: ListingSyncRunRecoveryMutationInput = {
  runId: '55555555-5555-4555-8555-555555555555',
  terminalStatus: 'failed',
  reason: 'PROCESS_CRASHED'
};

describe('listing sync run administrative recovery mutation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('posts only the 2.20U recovery contract to the internal API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ outcome: 'recovered' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(recoverListingSyncRun(input)).resolves.toEqual({ outcome: 'recovered' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/integrations/mercado-libre/listing-sync-runs/${input.runId}/recovery`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ terminalStatus: 'failed', reason: 'PROCESS_CRASHED' })
      })
    );
  });

  it('invalidates the administrative list after every controlled outcome', async () => {
    const result: ListingSyncRunRecoveryMutationResult = { outcome: 'already_terminal' };
    const context: MutationFunctionContext = {
      client: new QueryClient(),
      meta: undefined
    };

    await listingSyncRunRecoveryMutation.onSuccess?.(result, input, undefined, context);

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: listingSyncRunAdminKeys.all
    });
  });
});
