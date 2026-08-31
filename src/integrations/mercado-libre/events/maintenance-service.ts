import 'server-only';

import {
  IntegrationEventMaintenanceRepository,
  type IntegrationEventMaintenanceCounters
} from '@/infrastructure/database/integration-event-maintenance-repository';
import { IntegrationEventProcessingRepository } from '@/infrastructure/database/integration-event-processing-repository';
import { MercadoLibreMissedFeedRecoveryService } from './missed-feeds';
import { MercadoLibreEventProcessor, type MercadoLibreEventProcessingResult } from './processor';

export const EVENT_MAINTENANCE_BUDGET = {
  connections: 10,
  received: 25,
  retries: 25,
  missedFeedPages: 10,
  durationMs: 45_000,
  missedFeedCadenceMs: 15 * 60 * 1000
} as const;

export interface IncrementalEventMaintenanceResult {
  status: 'succeeded' | 'partial' | 'failed';
  connectionsSelected: number;
  connectionsStarted: number;
  connectionsSkipped: number;
  counters: IntegrationEventMaintenanceCounters;
  safeErrors: readonly ('event_processing_failed' | 'missed_feed_failed')[];
}

export interface IncrementalEventMaintenanceDependencies {
  maintenance?: Pick<
    IntegrationEventMaintenanceRepository,
    'listConnectionIds' | 'start' | 'checkpoint' | 'reclaimStale' | 'finalize'
  >;
  events?: Pick<
    IntegrationEventProcessingRepository,
    'listReceivedForConnection' | 'listDueRetriesForConnection'
  >;
  processor?: Pick<MercadoLibreEventProcessor, 'process'>;
  missedFeeds?: Pick<MercadoLibreMissedFeedRecoveryService, 'recoverItems'>;
  now?: () => Date;
}

export class IncrementalEventMaintenanceError extends Error {
  constructor(
    public readonly code:
      | 'selection_failed'
      | 'start_failed'
      | 'checkpoint_failed'
      | 'finalize_failed'
  ) {
    super(code);
    this.name = 'IncrementalEventMaintenanceError';
  }
}

export async function runIncrementalEventMaintenance(
  dependencies: IncrementalEventMaintenanceDependencies = {}
): Promise<IncrementalEventMaintenanceResult> {
  const maintenance = dependencies.maintenance ?? new IntegrationEventMaintenanceRepository();
  const events = dependencies.events ?? new IntegrationEventProcessingRepository();
  const processor = dependencies.processor ?? new MercadoLibreEventProcessor();
  const missedFeeds = dependencies.missedFeeds ?? new MercadoLibreMissedFeedRecoveryService();
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().getTime();
  let connectionIds: readonly string[];
  try {
    connectionIds = await maintenance.listConnectionIds(EVENT_MAINTENANCE_BUDGET.connections);
  } catch {
    throw new IncrementalEventMaintenanceError('selection_failed');
  }

  const aggregate = emptyCounters();
  const safeErrors = new Set<'event_processing_failed' | 'missed_feed_failed'>();
  let connectionsStarted = 0;
  let connectionsSkipped = 0;
  let receivedRemaining = EVENT_MAINTENANCE_BUDGET.received;
  let retriesRemaining = EVENT_MAINTENANCE_BUDGET.retries;
  let missedPagesRemaining = EVENT_MAINTENANCE_BUDGET.missedFeedPages;

  for (const connectionId of connectionIds) {
    if (!withinBudget(now, startedAt)) break;
    let run;
    try {
      const missedFeedDueBefore = new Date(
        now().getTime() - EVENT_MAINTENANCE_BUDGET.missedFeedCadenceMs
      ).toISOString();
      run = await maintenance.start(connectionId, missedFeedDueBefore);
      if (run.outcome === 'ALREADY_RUNNING' && run.runId) {
        const reclaim = await maintenance.reclaimStale(run.runId);
        if (reclaim === 'RECLAIMED' || reclaim === 'ALREADY_TERMINAL') {
          run = await maintenance.start(connectionId, missedFeedDueBefore);
        }
      }
    } catch {
      throw new IncrementalEventMaintenanceError('start_failed');
    }
    if (run.outcome !== 'STARTED' || !run.runId || !run.organizationId || !run.storeId) {
      connectionsSkipped += 1;
      continue;
    }

    connectionsStarted += 1;
    const counters = emptyCounters();
    let errorCode: 'event_processing_failed' | 'missed_feed_failed' | null = null;
    let errorSummary:
      | 'One or more integration events could not be processed'
      | 'Missed feeds recovery failed safely'
      | null = null;
    let missedFeedOffset = run.missedFeedOffset;
    let lastMissedFeedCheckAt: string | null = null;

    if (receivedRemaining > 0 && withinBudget(now, startedAt)) {
      const selection = await selectEvents(() =>
        events.listReceivedForConnection(connectionId, receivedRemaining)
      );
      const selected = selection.eventIds;
      counters.receivedSelected += selected.length;
      receivedRemaining -= selected.length;
      if (selection.failed || (await processEvents(selected, processor, counters))) {
        errorCode = 'event_processing_failed';
        errorSummary = 'One or more integration events could not be processed';
        safeErrors.add('event_processing_failed');
      }
      await checkpointRun(
        maintenance,
        run.runId,
        counters,
        missedFeedOffset,
        lastMissedFeedCheckAt
      );
    }

    if (retriesRemaining > 0 && withinBudget(now, startedAt)) {
      const selection = await selectEvents(() =>
        events.listDueRetriesForConnection(connectionId, retriesRemaining)
      );
      const selected = selection.eventIds;
      counters.retrySelected += selected.length;
      retriesRemaining -= selected.length;
      if (selection.failed || (await processEvents(selected, processor, counters))) {
        safeErrors.add('event_processing_failed');
        if (errorCode === null) {
          errorCode = 'event_processing_failed';
          errorSummary = 'One or more integration events could not be processed';
        }
      }
      await checkpointRun(
        maintenance,
        run.runId,
        counters,
        missedFeedOffset,
        lastMissedFeedCheckAt
      );
    }

    if (run.missedFeedDue && missedPagesRemaining > 0 && withinBudget(now, startedAt)) {
      try {
        const result = await missedFeeds.recoverItems({
          organizationId: run.organizationId,
          connectionId,
          offset: run.missedFeedOffset ?? 0,
          maxPages: missedPagesRemaining
        });
        counters.missedFeedPages += result.pages;
        counters.missedFeedAccepted += result.accepted;
        counters.missedFeedDuplicate += result.duplicates;
        missedPagesRemaining -= result.pages;
        missedFeedOffset = result.exhausted ? null : result.nextOffset;
        lastMissedFeedCheckAt = now().toISOString();
      } catch {
        safeErrors.add('missed_feed_failed');
        if (errorCode === null) {
          errorCode = 'missed_feed_failed';
          errorSummary = 'Missed feeds recovery failed safely';
        }
        lastMissedFeedCheckAt = now().toISOString();
      }
      await checkpointRun(
        maintenance,
        run.runId,
        counters,
        missedFeedOffset,
        lastMissedFeedCheckAt
      );
    }

    if (counters.missedFeedAccepted > 0 && receivedRemaining > 0 && withinBudget(now, startedAt)) {
      const selection = await selectEvents(() =>
        events.listReceivedForConnection(connectionId, receivedRemaining)
      );
      const selected = selection.eventIds;
      counters.receivedSelected += selected.length;
      receivedRemaining -= selected.length;
      if (selection.failed || (await processEvents(selected, processor, counters))) {
        safeErrors.add('event_processing_failed');
        if (errorCode === null) {
          errorCode = 'event_processing_failed';
          errorSummary = 'One or more integration events could not be processed';
        }
      }
      await checkpointRun(
        maintenance,
        run.runId,
        counters,
        missedFeedOffset,
        lastMissedFeedCheckAt
      );
    }

    const status = terminalStatus(counters, errorCode);
    const outcome = await maintenance.finalize({
      runId: run.runId,
      status,
      counters,
      missedFeedOffset,
      lastMissedFeedCheckAt,
      errorCode,
      errorSummary
    });
    if (outcome !== 'FINALIZED') throw new IncrementalEventMaintenanceError('finalize_failed');
    addCounters(aggregate, counters);
  }

  return {
    status:
      safeErrors.size === 0
        ? 'succeeded'
        : connectionsStarted > 0 && successfulWork(aggregate) > 0
          ? 'partial'
          : 'failed',
    connectionsSelected: connectionIds.length,
    connectionsStarted,
    connectionsSkipped,
    counters: aggregate,
    safeErrors: [...safeErrors]
  };
}

async function checkpointRun(
  maintenance: Pick<IntegrationEventMaintenanceRepository, 'checkpoint'>,
  runId: string,
  counters: IntegrationEventMaintenanceCounters,
  missedFeedOffset: number | null,
  lastMissedFeedCheckAt: string | null
): Promise<void> {
  try {
    const outcome = await maintenance.checkpoint({
      runId,
      counters,
      missedFeedOffset,
      lastMissedFeedCheckAt
    });
    if (outcome !== 'CHECKPOINTED') {
      throw new IncrementalEventMaintenanceError('checkpoint_failed');
    }
  } catch (error) {
    if (error instanceof IncrementalEventMaintenanceError) throw error;
    throw new IncrementalEventMaintenanceError('checkpoint_failed');
  }
}

async function processEvents(
  eventIds: readonly string[],
  processor: Pick<MercadoLibreEventProcessor, 'process'>,
  counters: IntegrationEventMaintenanceCounters
): Promise<boolean> {
  let failed = false;
  for (const eventId of eventIds) {
    try {
      failed = countOutcome(counters, await processor.process(eventId)) || failed;
    } catch {
      counters.failedPermanent += 1;
      failed = true;
    }
  }
  return failed;
}

function countOutcome(
  counters: IntegrationEventMaintenanceCounters,
  result: MercadoLibreEventProcessingResult
): boolean {
  if (result.outcome === 'APPLY') counters.processed += 1;
  else if (result.outcome === 'STALE_NOOP') counters.staleNoop += 1;
  else if (result.outcome === 'EQUIVALENT_NOOP') counters.equivalentNoop += 1;
  else if (result.outcome === 'FAILED_RETRYABLE') counters.retryScheduled += 1;
  else if (result.outcome === 'FAILED_PERMANENT' && result.safeErrorCode === 'retry_exhausted') {
    counters.retryExhausted += 1;
  } else if (result.outcome === 'FAILED_PERMANENT') counters.failedPermanent += 1;
  else counters.skipped += 1;
  return result.outcome === 'FAILED_PERMANENT';
}

async function selectEvents(
  operation: () => Promise<readonly string[]>
): Promise<{ eventIds: readonly string[]; failed: boolean }> {
  try {
    return { eventIds: await operation(), failed: false };
  } catch {
    return { eventIds: [], failed: true };
  }
}

function emptyCounters(): IntegrationEventMaintenanceCounters {
  return {
    receivedSelected: 0,
    retrySelected: 0,
    processed: 0,
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
}

function addCounters(
  aggregate: IntegrationEventMaintenanceCounters,
  counters: IntegrationEventMaintenanceCounters
): void {
  for (const key of Object.keys(aggregate) as (keyof IntegrationEventMaintenanceCounters)[]) {
    aggregate[key] += counters[key];
  }
}

function withinBudget(now: () => Date, startedAt: number): boolean {
  return now().getTime() - startedAt < EVENT_MAINTENANCE_BUDGET.durationMs;
}

function terminalStatus(
  counters: IntegrationEventMaintenanceCounters,
  errorCode: 'event_processing_failed' | 'missed_feed_failed' | null
): 'succeeded' | 'partial' | 'failed' {
  if (errorCode === null) return 'succeeded';
  return successfulWork(counters) > 0 ? 'partial' : 'failed';
}

function successfulWork(counters: IntegrationEventMaintenanceCounters): number {
  return (
    counters.processed +
    counters.staleNoop +
    counters.equivalentNoop +
    counters.retryScheduled +
    counters.missedFeedAccepted +
    counters.missedFeedDuplicate
  );
}
