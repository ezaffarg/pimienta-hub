import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { EVENT_MAINTENANCE_BUDGET, runIncrementalEventMaintenance } from './maintenance-service';
import { MercadoLibreMissedFeedsError } from './missed-feeds';

const connectionId = '10000000-0000-4000-8000-000000000001';
const runId = '10000000-0000-4000-8000-000000000002';
const receivedId = '10000000-0000-4000-8000-000000000003';
const retryId = '10000000-0000-4000-8000-000000000004';
const missedId = '10000000-0000-4000-8000-000000000005';

function setup() {
  const maintenance = {
    listConnectionIds: vi.fn().mockResolvedValue([connectionId]),
    start: vi.fn().mockResolvedValue({
      outcome: 'STARTED',
      runId,
      organizationId: 'org_test',
      storeId: '10000000-0000-4000-8000-000000000006',
      connectionId,
      missedFeedDue: true,
      missedFeedOffset: null
    }),
    checkpoint: vi.fn().mockResolvedValue('CHECKPOINTED'),
    reclaimStale: vi.fn().mockResolvedValue('NOT_STALE'),
    finalize: vi.fn().mockResolvedValue('FINALIZED')
  };
  const events = {
    listReceivedForConnection: vi
      .fn()
      .mockResolvedValueOnce([receivedId])
      .mockResolvedValueOnce([missedId]),
    listDueRetriesForConnection: vi.fn().mockResolvedValue([retryId])
  };
  const processor = {
    process: vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'APPLY', processingAttempts: 1, safeErrorCode: null })
      .mockResolvedValueOnce({
        outcome: 'FAILED_RETRYABLE',
        processingAttempts: 2,
        safeErrorCode: 'provider_timeout'
      })
      .mockResolvedValueOnce({ outcome: 'STALE_NOOP', processingAttempts: 1, safeErrorCode: null })
  };
  const missedFeeds = {
    recoverItems: vi.fn().mockResolvedValue({
      pages: 1,
      accepted: 1,
      duplicates: 1,
      exhausted: false,
      nextOffset: 10,
      providerCallsAttempted: 2,
      providerCallsSucceeded: 2
    })
  };
  return { maintenance, events, processor, missedFeeds };
}

describe('runIncrementalEventMaintenance', () => {
  it('runs received, retry, missed-feeds and remaining received work in order', async () => {
    const test = setup();

    await expect(
      runIncrementalEventMaintenance({ ...test, now: () => new Date('2026-08-28T12:00:00Z') })
    ).resolves.toMatchObject({
      status: 'succeeded',
      connectionsSelected: 1,
      connectionsStarted: 1,
      counters: {
        receivedSelected: 2,
        retrySelected: 1,
        processed: 1,
        staleNoop: 1,
        retryScheduled: 1,
        missedFeedAccepted: 1,
        missedFeedDuplicate: 1,
        missedFeedPages: 1,
        providerCallsAttempted: 2,
        providerCallsSucceeded: 2
      }
    });
    expect(test.processor.process.mock.calls.map(([id]) => id)).toEqual([
      receivedId,
      retryId,
      missedId
    ]);
    expect(test.missedFeeds.recoverItems).toHaveBeenCalledWith({
      organizationId: 'org_test',
      connectionId,
      offset: 0,
      maxPages: EVENT_MAINTENANCE_BUDGET.missedFeedPages
    });
    expect(test.maintenance.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded', missedFeedOffset: 10 })
    );
    expect(test.maintenance.checkpoint).toHaveBeenCalledTimes(4);
  });

  it('isolates event and missed-feed failures and persists only safe errors', async () => {
    const test = setup();
    test.events.listReceivedForConnection.mockReset().mockResolvedValueOnce([receivedId, missedId]);
    test.events.listDueRetriesForConnection.mockResolvedValue([]);
    test.processor.process
      .mockReset()
      .mockRejectedValueOnce(new Error('raw provider token'))
      .mockResolvedValueOnce({ outcome: 'APPLY', processingAttempts: 1, safeErrorCode: null });
    test.missedFeeds.recoverItems.mockRejectedValue(new Error('raw feed body'));

    const result = await runIncrementalEventMaintenance({
      ...test,
      now: () => new Date('2026-08-28T12:00:00Z')
    });

    expect(result.status).toBe('partial');
    expect(result.safeErrors).toEqual(['event_processing_failed', 'missed_feed_failed']);
    expect(test.processor.process).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(test.maintenance.finalize.mock.calls)).not.toContain('token');
    expect(JSON.stringify(test.maintenance.finalize.mock.calls)).not.toContain('feed body');
  });

  it('records a failed missed-feed attempt and reuses the cadence timestamp safely', async () => {
    const test = setup();
    test.events.listReceivedForConnection.mockReset().mockResolvedValue([]);
    test.events.listDueRetriesForConnection.mockResolvedValue([]);
    test.missedFeeds.recoverItems.mockRejectedValue(
      new MercadoLibreMissedFeedsError('provider_unavailable', {
        failureStage: 'missed_feed_request',
        providerCallsAttempted: 2,
        providerCallsSucceeded: 1
      })
    );

    await expect(
      runIncrementalEventMaintenance({
        ...test,
        now: () => new Date('2026-08-28T12:00:00Z')
      })
    ).resolves.toMatchObject({
      status: 'failed',
      counters: {
        missedFeedAccepted: 0,
        missedFeedDuplicate: 0,
        missedFeedPages: 0,
        providerCallsAttempted: 2,
        providerCallsSucceeded: 1
      },
      safeErrors: ['missed_feed_failed']
    });
    expect(test.maintenance.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        missedFeedOffset: null,
        lastMissedFeedCheckAt: '2026-08-28T12:00:00.000Z',
        missedFeedFailureStage: 'missed_feed_request',
        errorCode: 'missed_feed_failed',
        errorSummary: 'Missed feeds recovery failed safely'
      })
    );
    expect(JSON.stringify(test.maintenance.finalize.mock.calls)).not.toContain('payload');
  });

  it('respects total work budgets without an automatic loop', async () => {
    const test = setup();
    const received = Array.from(
      { length: EVENT_MAINTENANCE_BUDGET.received },
      (_, index) => `10000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`
    );
    const retries = Array.from(
      { length: EVENT_MAINTENANCE_BUDGET.retries },
      (_, index) => `20000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`
    );
    test.events.listReceivedForConnection.mockReset().mockResolvedValue(received);
    test.events.listDueRetriesForConnection.mockResolvedValue(retries);
    test.processor.process.mockReset().mockResolvedValue({
      outcome: 'ALREADY_PROCESSED',
      processingAttempts: null,
      safeErrorCode: null
    });

    const result = await runIncrementalEventMaintenance({
      ...test,
      now: () => new Date('2026-08-28T12:00:00Z')
    });

    expect(result.counters.receivedSelected).toBe(EVENT_MAINTENANCE_BUDGET.received);
    expect(result.counters.retrySelected).toBe(EVENT_MAINTENANCE_BUDGET.retries);
    expect(test.processor.process).toHaveBeenCalledTimes(
      EVENT_MAINTENANCE_BUDGET.received + EVENT_MAINTENANCE_BUDGET.retries
    );
    expect(test.missedFeeds.recoverItems).toHaveBeenCalledTimes(1);
  });

  it('skips a Connection already owned by a concurrent maintenance run', async () => {
    const test = setup();
    test.maintenance.start.mockResolvedValue({
      outcome: 'ALREADY_RUNNING',
      runId,
      organizationId: 'org_test',
      storeId: '10000000-0000-4000-8000-000000000006',
      connectionId,
      missedFeedDue: true,
      missedFeedOffset: 0
    });

    await expect(runIncrementalEventMaintenance(test)).resolves.toMatchObject({
      connectionsStarted: 0,
      connectionsSkipped: 1
    });
    expect(test.processor.process).not.toHaveBeenCalled();
    expect(test.missedFeeds.recoverItems).not.toHaveBeenCalled();
    expect(test.maintenance.finalize).not.toHaveBeenCalled();
    expect(test.maintenance.reclaimStale).toHaveBeenCalledWith(runId);
  });

  it('reclaims one stale run and retries start once before processing', async () => {
    const test = setup();
    const started = await test.maintenance.start();
    test.maintenance.start
      .mockReset()
      .mockResolvedValueOnce({ ...started, outcome: 'ALREADY_RUNNING' })
      .mockResolvedValueOnce(started);
    test.maintenance.reclaimStale.mockResolvedValue('RECLAIMED');

    await expect(runIncrementalEventMaintenance(test)).resolves.toMatchObject({
      connectionsStarted: 1,
      connectionsSkipped: 0
    });
    expect(test.maintenance.start).toHaveBeenCalledTimes(2);
    expect(test.maintenance.reclaimStale).toHaveBeenCalledTimes(1);
    expect(test.maintenance.finalize).toHaveBeenCalledTimes(1);
  });

  it('stops before starting work after the total duration budget', async () => {
    const test = setup();
    const now = vi
      .fn()
      .mockReturnValueOnce(new Date('2026-08-28T12:00:00.000Z'))
      .mockReturnValue(new Date('2026-08-28T12:00:45.000Z'));

    await expect(runIncrementalEventMaintenance({ ...test, now })).resolves.toMatchObject({
      connectionsSelected: 1,
      connectionsStarted: 0
    });
    expect(test.maintenance.start).not.toHaveBeenCalled();
  });
});
