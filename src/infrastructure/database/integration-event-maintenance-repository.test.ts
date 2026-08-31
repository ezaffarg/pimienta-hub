import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { IntegrationEventMaintenanceRepository } from './integration-event-maintenance-repository';

const connectionId = '10000000-0000-4000-8000-000000000001';
const runId = '10000000-0000-4000-8000-000000000002';

describe('IntegrationEventMaintenanceRepository', () => {
  it('maps candidates and a tenant-derived start result', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ connection_id: connectionId }], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: 'started',
            run_id: runId,
            organization_id: 'org_test',
            store_id: '10000000-0000-4000-8000-000000000003',
            connection_id: connectionId,
            missed_feed_due: true,
            missed_feed_offset: 20
          }
        ],
        error: null
      });
    const repository = new IntegrationEventMaintenanceRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(repository.listConnectionIds(10)).resolves.toEqual([connectionId]);
    await expect(repository.start(connectionId, '2026-08-28T11:45:00.000Z')).resolves.toMatchObject(
      {
        outcome: 'STARTED',
        organizationId: 'org_test',
        connectionId,
        missedFeedOffset: 20
      }
    );
  });

  it('finalizes only controlled counters and safe error metadata', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'finalized', error: null });
    const repository = new IntegrationEventMaintenanceRepository({
      rpc
    } as unknown as SupabaseClient);
    const counters = {
      receivedSelected: 1,
      retrySelected: 1,
      processed: 1,
      staleNoop: 0,
      equivalentNoop: 0,
      retryScheduled: 1,
      retryExhausted: 0,
      failedPermanent: 0,
      skipped: 0,
      missedFeedAccepted: 1,
      missedFeedDuplicate: 1,
      missedFeedPages: 1
    };

    await expect(
      repository.finalize({
        runId,
        status: 'partial',
        counters,
        missedFeedOffset: 10,
        lastMissedFeedCheckAt: '2026-08-28T12:00:00.000Z',
        errorCode: 'event_processing_failed',
        errorSummary: 'One or more integration events could not be processed'
      })
    ).resolves.toBe('FINALIZED');
    expect(rpc).toHaveBeenCalledWith(
      'finalize_integration_event_maintenance_run',
      expect.objectContaining({
        p_run_id: runId,
        p_received_selected: 1,
        p_error_code: 'event_processing_failed'
      })
    );
  });

  it('maps a tenant-scoped operations summary', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          received_backlog: 2,
          retry_due: 1,
          processing: 0,
          processed_recent: 4,
          failed: 1,
          retry_exhausted: 0,
          last_run_id: runId,
          last_run_status: 'failed',
          last_run_error_code: 'maintenance_stale_reclaimed',
          last_run_started_at: '2026-08-28T12:00:00.000Z',
          last_run_completed_at: '2026-08-28T12:00:10.000Z',
          last_missed_feed_check_at: '2026-08-28T12:00:05.000Z',
          last_run_received_selected: 2,
          last_run_retry_selected: 1,
          last_run_processed: 3,
          last_run_failed: 0,
          last_run_missed_feed_accepted: 1,
          last_run_missed_feed_duplicate: 1
        }
      ],
      error: null
    });
    const repository = new IntegrationEventMaintenanceRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(repository.summary('org_test')).resolves.toMatchObject({
      receivedBacklog: 2,
      retryDue: 1,
      lastRun: { id: runId, processed: 3, errorCode: 'maintenance_stale_reclaimed' }
    });
    expect(rpc).toHaveBeenCalledWith('get_integration_event_operations_summary', {
      p_organization_id: 'org_test'
    });
  });

  it('checkpoints controlled progress and reclaims without caller-provided cutoff', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 'checkpointed', error: null })
      .mockResolvedValueOnce({ data: 'reclaimed', error: null });
    const repository = new IntegrationEventMaintenanceRepository({
      rpc
    } as unknown as SupabaseClient);
    const counters = {
      receivedSelected: 1,
      retrySelected: 0,
      processed: 1,
      staleNoop: 0,
      equivalentNoop: 0,
      retryScheduled: 0,
      retryExhausted: 0,
      failedPermanent: 0,
      skipped: 0,
      missedFeedAccepted: 0,
      missedFeedDuplicate: 0,
      missedFeedPages: 0
    };

    await expect(
      repository.checkpoint({
        runId,
        counters,
        missedFeedOffset: null,
        lastMissedFeedCheckAt: null
      })
    ).resolves.toBe('CHECKPOINTED');
    await expect(repository.reclaimStale(runId)).resolves.toBe('RECLAIMED');

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'checkpoint_integration_event_maintenance_run',
      expect.objectContaining({ p_run_id: runId, p_processed: 1 })
    );
    expect(rpc).toHaveBeenNthCalledWith(2, 'reclaim_stale_integration_event_maintenance_run', {
      p_run_id: runId
    });
  });

  it('sanitizes thrown RPC errors', async () => {
    const repository = new IntegrationEventMaintenanceRepository({
      rpc: vi.fn().mockRejectedValue(new Error('raw SQL secret'))
    } as unknown as SupabaseClient);
    const error = await repository.listConnectionIds(10).catch((cause) => cause);
    expect(JSON.stringify(error)).not.toContain('raw SQL secret');
  });
});
