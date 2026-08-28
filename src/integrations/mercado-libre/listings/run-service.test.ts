import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  ListingSyncRunStartError,
  type ListingSyncRunRecord
} from '@/infrastructure/database/listing-sync-run-repository';
import { PersistenceError } from '@/infrastructure/database/repositories';
import { MercadoLibreCredentialError } from '../auth';
import { MercadoLibreListingsError } from './client';
import { MercadoLibreListingSyncRunError, MercadoLibreListingSyncRunService } from './run-service';

const input = {
  organizationId: 'org_a',
  storeId: '11111111-1111-4111-8111-111111111111',
  connectionId: '22222222-2222-4222-8222-222222222222',
  actorMembershipId: '33333333-3333-4333-8333-333333333333',
  idempotencyKey: '44444444-4444-4444-8444-444444444444'
};
const emptyProgress = {
  discovered: 0,
  requested: 0,
  fetched: 0,
  persisted: 0,
  failed: 0,
  pages: 0,
  batches: 0
};
const completeProgress = {
  discovered: 1,
  requested: 1,
  fetched: 1,
  persisted: 1,
  failed: 0,
  pages: 1,
  batches: 1
};

function run(
  status: ListingSyncRunRecord['status'] = 'running',
  overrides: Partial<ListingSyncRunRecord> = {}
): ListingSyncRunRecord {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: input.organizationId,
    storeId: input.storeId,
    connectionId: input.connectionId,
    actorMembershipId: input.actorMembershipId,
    kind: 'listing_backfill',
    idempotencyKey: input.idempotencyKey,
    status,
    startedAt: '2026-08-25T22:00:00.000Z',
    completedAt: status === 'running' ? null : '2026-08-25T22:01:00.000Z',
    lastCheckpointAt: '2026-08-25T22:01:00.000Z',
    ...emptyProgress,
    errorCode: null,
    errorSummary: null,
    reconciliationEligible: false,
    missingCandidateCount: 0,
    reappearedCount: 0,
    updatedAt: '2026-08-25T22:01:00.000Z',
    ...overrides
  };
}

function startedRuns(overrides: Record<string, unknown> = {}) {
  return {
    start: vi.fn().mockResolvedValue({ outcome: 'started', run: run() }),
    checkpoint: vi.fn().mockResolvedValue(run('running', completeProgress)),
    finalize: vi.fn().mockImplementation(({ status, progress, errorCode, errorSummary }) =>
      Promise.resolve(
        run(status, {
          ...progress,
          errorCode: errorCode ?? null,
          errorSummary: errorSummary ?? null
        })
      )
    ),
    ...overrides
  };
}

describe('MercadoLibreListingSyncRunService', () => {
  it('checkpoints progress and finalizes a successful backfill', async () => {
    const runs = startedRuns();
    const syncAllActiveConnectionListings = vi.fn(async (_scope, onProgress) => {
      await onProgress(completeProgress);
      return { ...completeProgress, failures: [], reconciliationEligible: true };
    });
    const service = new MercadoLibreListingSyncRunService(
      runs as never,
      {
        syncAllActiveConnectionListings
      } as never
    );

    await expect(service.execute(input)).resolves.toMatchObject({
      outcome: 'executed',
      run: { status: 'succeeded' },
      backfill: completeProgress
    });
    expect(runs.start).toHaveBeenCalledWith({
      scope: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        connectionId: input.connectionId
      },
      actorMembershipId: input.actorMembershipId,
      idempotencyKey: input.idempotencyKey
    });
    expect(runs.checkpoint).toHaveBeenCalledWith({
      scope: expect.objectContaining({ organizationId: input.organizationId }),
      runId: run().id,
      progress: completeProgress
    });
    expect(runs.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        progress: completeProgress,
        reconciliationEligible: true,
        errorCode: null,
        errorSummary: null
      })
    );
  });

  it('finalizes partial when item failures do not stop the completed backfill', async () => {
    const runs = startedRuns();
    const partial = {
      ...completeProgress,
      fetched: 0,
      persisted: 0,
      failed: 1
    };
    const service = new MercadoLibreListingSyncRunService(
      runs as never,
      {
        syncAllActiveConnectionListings: vi.fn().mockResolvedValue({
          ...partial,
          failures: [
            {
              externalListingId: 'MLA1',
              kind: 'provider_client_error',
              retryable: false,
              status: 404
            }
          ]
        })
      } as never
    );

    await expect(service.execute(input)).resolves.toMatchObject({
      outcome: 'executed',
      run: { status: 'partial', errorCode: 'partial_item_failure' }
    });
    expect(runs.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'partial',
        errorCode: 'partial_item_failure',
        errorSummary: 'One or more listing items could not be synchronized'
      })
    );
  });

  it('records a safe failed run without persisting the raw provider error', async () => {
    const runs = startedRuns();
    const service = new MercadoLibreListingSyncRunService(
      runs as never,
      {
        syncAllActiveConnectionListings: vi
          .fn()
          .mockRejectedValue(new MercadoLibreListingsError('provider_timeout', 'discovery', true))
      } as never
    );

    await expect(service.execute(input)).resolves.toMatchObject({
      outcome: 'executed',
      run: { status: 'failed', errorCode: 'provider_timeout' },
      backfill: null
    });
    expect(runs.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'provider_timeout',
        errorSummary: 'The provider timed out during the listing sync'
      })
    );
  });

  it.each([
    'READ',
    'DECRYPT',
    'CLAIM',
    'DOUBLE_CHECK',
    'PROVIDER_REQUEST',
    'PROVIDER_RESPONSE',
    'ENCRYPT',
    'CAS_COMPLETE'
  ] as const)(
    'persists the allowlisted credential stage %s without leaking raw material',
    async (stage) => {
      const runs = startedRuns();
      const credentialError = Object.assign(
        new MercadoLibreCredentialError('PROVIDER_NETWORK_ERROR', stage),
        {
          rawProviderMessage: 'raw-provider-detail',
          accessToken: 'access-token-material',
          refreshToken: 'refresh-token-material',
          authorization: 'Bearer header-material'
        }
      );
      const service = new MercadoLibreListingSyncRunService(
        runs as never,
        { syncAllActiveConnectionListings: vi.fn().mockRejectedValue(credentialError) } as never
      );

      await expect(service.execute(input)).resolves.toMatchObject({
        run: {
          status: 'failed',
          errorCode: 'credential_failure',
          errorSummary: `Credential refresh failed during ${stage}`
        }
      });
      const persisted = JSON.stringify(runs.finalize.mock.calls);
      expect(persisted).not.toContain('raw-provider-detail');
      expect(persisted).not.toContain('access-token-material');
      expect(persisted).not.toContain('refresh-token-material');
      expect(persisted).not.toContain('header-material');
    }
  );

  it('falls back to the generic credential summary for an unrecognized stage', async () => {
    const runs = startedRuns();
    const service = new MercadoLibreListingSyncRunService(
      runs as never,
      {
        syncAllActiveConnectionListings: vi
          .fn()
          .mockRejectedValue(
            new MercadoLibreCredentialError('REFRESH_UNKNOWN_ERROR', 'UNRECOGNIZED' as never)
          )
      } as never
    );

    await expect(service.execute(input)).resolves.toMatchObject({
      run: {
        status: 'failed',
        errorCode: 'credential_failure',
        errorSummary: 'A valid provider credential was unavailable'
      }
    });
  });

  it.each(['CAS_RPC_THROW', 'CAS_RPC_ERROR', 'CAS_RESPONSE_INVALID', 'CAS_REJECTED'] as const)(
    'persists the safe CAS classification %s without raw material',
    async (casFailure) => {
      const runs = startedRuns();
      const credentialError = Object.assign(
        new MercadoLibreCredentialError('REFRESH_COMPLETE_RPC_FAILED', 'CAS_COMPLETE', {
          casFailure
        }),
        { rawError: 'raw database detail', ciphertext: 'ciphertext-material' }
      );
      const service = new MercadoLibreListingSyncRunService(
        runs as never,
        { syncAllActiveConnectionListings: vi.fn().mockRejectedValue(credentialError) } as never
      );

      await expect(service.execute(input)).resolves.toMatchObject({
        run: {
          status: 'failed',
          errorCode: 'credential_failure',
          errorSummary: `Credential refresh failed during CAS_COMPLETE/${casFailure}`
        }
      });
      const persisted = JSON.stringify(runs.finalize.mock.calls);
      expect(persisted).not.toContain('raw database detail');
      expect(persisted).not.toContain('ciphertext-material');
    }
  );

  it.each(['reused', 'already_running'] as const)(
    'returns %s without executing another backfill',
    async (outcome) => {
      const runs = startedRuns({
        start: vi.fn().mockResolvedValue({ outcome, run: run() })
      });
      const syncAllActiveConnectionListings = vi.fn();
      const service = new MercadoLibreListingSyncRunService(
        runs as never,
        {
          syncAllActiveConnectionListings
        } as never
      );

      await expect(service.execute(input)).resolves.toMatchObject({
        outcome,
        backfill: null
      });
      expect(syncAllActiveConnectionListings).not.toHaveBeenCalled();
      expect(runs.finalize).not.toHaveBeenCalled();
    }
  );

  it('fails closed before provider work when the tenant-bound start is rejected', async () => {
    const runs = startedRuns({
      start: vi.fn().mockRejectedValue(
        new ListingSyncRunStartError('RUN_START_REJECTED', {
          stage: 'rpc_response',
          thrown: false,
          rpcReturnedData: false,
          rpcErrorPresent: true,
          rpcErrorCode: 'P0001',
          outcome: null,
          transportClass: null
        })
      )
    });
    const syncAllActiveConnectionListings = vi.fn();
    const service = new MercadoLibreListingSyncRunService(
      runs as never,
      {
        syncAllActiveConnectionListings
      } as never
    );

    await expect(service.execute(input)).rejects.toEqual(
      new MercadoLibreListingSyncRunError('run_start_failed', 'RUN_START_REJECTED', {
        stage: 'rpc_response',
        thrown: false,
        rpcReturnedData: false,
        rpcErrorPresent: true,
        rpcErrorCode: 'P0001',
        outcome: null,
        transportClass: null
      })
    );
    expect(syncAllActiveConnectionListings).not.toHaveBeenCalled();
  });

  it('classifies a checkpoint RPC failure conservatively and never declares success', async () => {
    const runs = startedRuns({
      checkpoint: vi.fn().mockRejectedValue(new PersistenceError('raw database detail'))
    });
    const service = new MercadoLibreListingSyncRunService(
      runs as never,
      {
        syncAllActiveConnectionListings: vi.fn(async (_scope, onProgress) => {
          await onProgress(completeProgress);
          return { ...completeProgress, failures: [], reconciliationEligible: true };
        })
      } as never
    );

    await expect(service.execute(input)).resolves.toMatchObject({
      outcome: 'executed',
      run: {
        status: 'failed',
        errorCode: 'persistence_failure',
        errorSummary: 'Listing sync persistence failed safely'
      },
      backfill: null
    });
    expect(runs.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'persistence_failure'
      })
    );
    expect(runs.finalize).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' })
    );
  });

  it('returns a safe error when the terminal observability write fails', async () => {
    const runs = startedRuns({
      finalize: vi.fn().mockRejectedValue(new Error('authorization raw database detail'))
    });
    const service = new MercadoLibreListingSyncRunService(
      runs as never,
      {
        syncAllActiveConnectionListings: vi
          .fn()
          .mockResolvedValue({ ...completeProgress, failures: [], reconciliationEligible: true })
      } as never
    );
    const error = await service.execute(input).catch((cause: unknown) => cause);

    expect(error).toEqual(new MercadoLibreListingSyncRunError('run_finalize_failed'));
    expect(error).not.toMatchObject({ message: expect.stringContaining('authorization') });
    expect(runs.finalize).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('executes independent runs with distinct idempotency keys', async () => {
    const runs = startedRuns({
      start: vi
        .fn()
        .mockResolvedValueOnce({ outcome: 'started', run: run() })
        .mockResolvedValueOnce({
          outcome: 'started',
          run: run('running', {
            id: '66666666-6666-4666-8666-666666666666',
            idempotencyKey: '77777777-7777-4777-8777-777777777777'
          })
        })
    });
    const syncAllActiveConnectionListings = vi
      .fn()
      .mockResolvedValue({ ...completeProgress, failures: [], reconciliationEligible: true });
    const service = new MercadoLibreListingSyncRunService(
      runs as never,
      {
        syncAllActiveConnectionListings
      } as never
    );

    await service.execute(input);
    await service.execute({
      ...input,
      idempotencyKey: '77777777-7777-4777-8777-777777777777'
    });
    expect(syncAllActiveConnectionListings).toHaveBeenCalledTimes(2);
  });
});
