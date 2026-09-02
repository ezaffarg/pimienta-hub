import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSupabaseServerClient } from './supabase-server';
import { PersistenceError } from './repositories';

export const integrationEventMaintenanceCountersSchema = z
  .object({
    receivedSelected: z.number().int().nonnegative(),
    retrySelected: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    staleNoop: z.number().int().nonnegative(),
    equivalentNoop: z.number().int().nonnegative(),
    retryScheduled: z.number().int().nonnegative(),
    retryExhausted: z.number().int().nonnegative(),
    failedPermanent: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    missedFeedAccepted: z.number().int().nonnegative(),
    missedFeedDuplicate: z.number().int().nonnegative(),
    missedFeedPages: z.number().int().nonnegative(),
    providerCallsAttempted: z.number().int().nonnegative(),
    providerCallsSucceeded: z.number().int().nonnegative()
  })
  .strict()
  .refine((value) => value.providerCallsSucceeded <= value.providerCallsAttempted, {
    message: 'Provider call counters invalid'
  });

export type IntegrationEventMaintenanceCounters = z.infer<
  typeof integrationEventMaintenanceCountersSchema
>;

export const INTEGRATION_EVENT_MAINTENANCE_STALE_AFTER_MS = 10 * 60 * 1000;

export const missedFeedFailureStageSchema = z.enum([
  'connection_resolution',
  'credential_resolution',
  'identity_request',
  'identity_validation',
  'configuration',
  'missed_feed_request',
  'missed_feed_response',
  'missed_feed_pagination',
  'event_intake',
  'other'
]);
export type MissedFeedFailureStage = z.infer<typeof missedFeedFailureStageSchema>;

export const credentialRefreshFailureStageSchema = z.enum([
  'refresh_credential_read',
  'refresh_credential_decrypt',
  'refresh_lease',
  'refresh_post_claim_validation',
  'refresh_provider_request',
  'refresh_provider_response',
  'refresh_response_validation',
  'refresh_encrypt',
  'refresh_cas',
  'refresh_post_persist_validation'
]);
export type CredentialRefreshFailureStage = z.infer<typeof credentialRefreshFailureStageSchema>;

export const credentialRefreshCasFailureSchema = z.enum([
  'CAS_RPC_THROW',
  'CAS_RPC_ERROR',
  'CAS_RESPONSE_INVALID',
  'CAS_CONFLICT'
]);
export type CredentialRefreshCasFailure = z.infer<typeof credentialRefreshCasFailureSchema>;

export const credentialRefreshDiagnosticsSchema = z
  .object({
    failureStage: credentialRefreshFailureStageSchema.nullable(),
    casFailure: credentialRefreshCasFailureSchema.nullable(),
    providerCallsAttempted: z.number().int().nonnegative(),
    providerCallsSucceeded: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.providerCallsSucceeded > value.providerCallsAttempted) {
      context.addIssue({ code: 'custom', message: 'Credential refresh counters invalid' });
    }
    if (value.casFailure !== null && value.failureStage !== 'refresh_cas') {
      context.addIssue({ code: 'custom', message: 'Credential refresh CAS stage invalid' });
    }
    if (value.failureStage === 'refresh_cas' && value.casFailure === null) {
      context.addIssue({ code: 'custom', message: 'Credential refresh CAS subtype missing' });
    }
  });
export type CredentialRefreshDiagnostics = z.infer<typeof credentialRefreshDiagnosticsSchema>;

export interface IntegrationEventMaintenanceRunStart {
  outcome: 'STARTED' | 'ALREADY_RUNNING' | 'NOT_ELIGIBLE';
  runId: string | null;
  organizationId: string | null;
  storeId: string | null;
  connectionId: string;
  missedFeedDue: boolean;
  missedFeedOffset: number | null;
}

export interface IntegrationEventOperationsSummary {
  receivedBacklog: number;
  retryDue: number;
  processing: number;
  processedRecent: number;
  failed: number;
  retryExhausted: number;
  lastRun: null | {
    id: string;
    status: 'running' | 'succeeded' | 'partial' | 'failed';
    errorCode:
      | 'event_processing_failed'
      | 'missed_feed_failed'
      | 'maintenance_stale_reclaimed'
      | null;
    startedAt: string;
    completedAt: string | null;
    lastMissedFeedCheckAt: string | null;
    receivedSelected: number;
    retrySelected: number;
    processed: number;
    failed: number;
    missedFeedAccepted: number;
    missedFeedDuplicate: number;
    missedFeedFailureStage: MissedFeedFailureStage | null;
    providerCallsAttempted: number | null;
    providerCallsSucceeded: number | null;
    credentialRefreshFailureStage: CredentialRefreshFailureStage | null;
    credentialRefreshCasFailure: CredentialRefreshCasFailure | null;
    credentialRefreshCallsAttempted: number | null;
    credentialRefreshCallsSucceeded: number | null;
  };
}

export class IntegrationEventMaintenanceRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServerClient()) {}

  async listConnectionIds(limit: number): Promise<readonly string[]> {
    const parsedLimit = z.number().int().min(1).max(100).parse(limit);
    const response = await safeRpc(() =>
      this.client.rpc('list_integration_event_maintenance_connections', {
        p_limit: parsedLimit
      })
    );
    const rows = z
      .array(z.object({ connection_id: z.uuid() }))
      .max(100)
      .safeParse(response.data);
    if (!rows.success) throw new PersistenceError('Maintenance connection response invalid');
    return rows.data.map((row) => row.connection_id);
  }

  async start(connectionId: string, missedFeedDueBefore: string) {
    const input = z
      .object({ connectionId: z.uuid(), missedFeedDueBefore: z.iso.datetime({ offset: true }) })
      .strict()
      .parse({ connectionId, missedFeedDueBefore });
    const response = await safeRpc(() =>
      this.client.rpc('start_integration_event_maintenance_run', {
        p_connection_id: input.connectionId,
        p_missed_feed_due_before: input.missedFeedDueBefore
      })
    );
    const rows = startRowsSchema.safeParse(response.data);
    if (!rows.success) throw new PersistenceError('Maintenance start response invalid');
    const row = rows.data[0];
    return {
      outcome: row.outcome.toUpperCase() as IntegrationEventMaintenanceRunStart['outcome'],
      runId: row.run_id,
      organizationId: row.organization_id,
      storeId: row.store_id,
      connectionId: row.connection_id,
      missedFeedDue: row.missed_feed_due,
      missedFeedOffset: row.missed_feed_offset
    } satisfies IntegrationEventMaintenanceRunStart;
  }

  async finalize(input: {
    runId: string;
    status: 'succeeded' | 'partial' | 'failed';
    counters: IntegrationEventMaintenanceCounters;
    missedFeedOffset: number | null;
    lastMissedFeedCheckAt: string | null;
    missedFeedFailureStage: MissedFeedFailureStage | null;
    credentialRefresh: CredentialRefreshDiagnostics;
    errorCode: 'event_processing_failed' | 'missed_feed_failed' | null;
    errorSummary:
      | 'One or more integration events could not be processed'
      | 'Missed feeds recovery failed safely'
      | null;
  }): Promise<'FINALIZED' | 'ALREADY_TERMINAL' | 'NOT_FOUND'> {
    const parsed = finalizeSchema.parse(input);
    const response = await safeRpc(() =>
      this.client.rpc('finalize_integration_event_maintenance_run', {
        p_run_id: parsed.runId,
        p_status: parsed.status,
        p_received_selected: parsed.counters.receivedSelected,
        p_retry_selected: parsed.counters.retrySelected,
        p_processed: parsed.counters.processed,
        p_stale_noop: parsed.counters.staleNoop,
        p_equivalent_noop: parsed.counters.equivalentNoop,
        p_retry_scheduled: parsed.counters.retryScheduled,
        p_retry_exhausted: parsed.counters.retryExhausted,
        p_failed_permanent: parsed.counters.failedPermanent,
        p_skipped: parsed.counters.skipped,
        p_missed_feed_accepted: parsed.counters.missedFeedAccepted,
        p_missed_feed_duplicate: parsed.counters.missedFeedDuplicate,
        p_missed_feed_pages: parsed.counters.missedFeedPages,
        p_provider_calls_attempted: parsed.counters.providerCallsAttempted,
        p_provider_calls_succeeded: parsed.counters.providerCallsSucceeded,
        p_missed_feed_offset: parsed.missedFeedOffset,
        p_last_missed_feed_check_at: parsed.lastMissedFeedCheckAt,
        p_missed_feed_failure_stage: parsed.missedFeedFailureStage,
        p_credential_refresh_failure_stage: parsed.credentialRefresh.failureStage,
        p_credential_refresh_cas_failure: parsed.credentialRefresh.casFailure,
        p_credential_refresh_calls_attempted: parsed.credentialRefresh.providerCallsAttempted,
        p_credential_refresh_calls_succeeded: parsed.credentialRefresh.providerCallsSucceeded,
        p_error_code: parsed.errorCode,
        p_error_summary: parsed.errorSummary
      })
    );
    return z
      .enum(['finalized', 'already_terminal', 'not_found'])
      .transform((value) => value.toUpperCase() as 'FINALIZED' | 'ALREADY_TERMINAL' | 'NOT_FOUND')
      .parse(response.data);
  }

  async checkpoint(input: {
    runId: string;
    counters: IntegrationEventMaintenanceCounters;
    missedFeedOffset: number | null;
    lastMissedFeedCheckAt: string | null;
    missedFeedFailureStage: MissedFeedFailureStage | null;
    credentialRefresh: CredentialRefreshDiagnostics;
  }): Promise<'CHECKPOINTED' | 'ALREADY_TERMINAL' | 'NOT_FOUND'> {
    const parsed = checkpointSchema.parse(input);
    const response = await safeRpc(() =>
      this.client.rpc('checkpoint_integration_event_maintenance_run', {
        p_run_id: parsed.runId,
        p_received_selected: parsed.counters.receivedSelected,
        p_retry_selected: parsed.counters.retrySelected,
        p_processed: parsed.counters.processed,
        p_stale_noop: parsed.counters.staleNoop,
        p_equivalent_noop: parsed.counters.equivalentNoop,
        p_retry_scheduled: parsed.counters.retryScheduled,
        p_retry_exhausted: parsed.counters.retryExhausted,
        p_failed_permanent: parsed.counters.failedPermanent,
        p_skipped: parsed.counters.skipped,
        p_missed_feed_accepted: parsed.counters.missedFeedAccepted,
        p_missed_feed_duplicate: parsed.counters.missedFeedDuplicate,
        p_missed_feed_pages: parsed.counters.missedFeedPages,
        p_provider_calls_attempted: parsed.counters.providerCallsAttempted,
        p_provider_calls_succeeded: parsed.counters.providerCallsSucceeded,
        p_missed_feed_offset: parsed.missedFeedOffset,
        p_last_missed_feed_check_at: parsed.lastMissedFeedCheckAt,
        p_missed_feed_failure_stage: parsed.missedFeedFailureStage,
        p_credential_refresh_failure_stage: parsed.credentialRefresh.failureStage,
        p_credential_refresh_cas_failure: parsed.credentialRefresh.casFailure,
        p_credential_refresh_calls_attempted: parsed.credentialRefresh.providerCallsAttempted,
        p_credential_refresh_calls_succeeded: parsed.credentialRefresh.providerCallsSucceeded
      })
    );
    return z
      .enum(['checkpointed', 'already_terminal', 'not_found'])
      .transform(
        (value) => value.toUpperCase() as 'CHECKPOINTED' | 'ALREADY_TERMINAL' | 'NOT_FOUND'
      )
      .parse(response.data);
  }

  async reclaimStale(
    runId: string
  ): Promise<'RECLAIMED' | 'NOT_STALE' | 'ALREADY_TERMINAL' | 'NOT_FOUND'> {
    const parsedRunId = z.uuid().parse(runId);
    const response = await safeRpc(() =>
      this.client.rpc('reclaim_stale_integration_event_maintenance_run', {
        p_run_id: parsedRunId
      })
    );
    return z
      .enum(['reclaimed', 'not_stale', 'already_terminal', 'not_found'])
      .transform(
        (value) =>
          value.toUpperCase() as 'RECLAIMED' | 'NOT_STALE' | 'ALREADY_TERMINAL' | 'NOT_FOUND'
      )
      .parse(response.data);
  }

  async summary(organizationId: string): Promise<IntegrationEventOperationsSummary> {
    const parsedOrganizationId = z.string().trim().min(1).max(255).parse(organizationId);
    const response = await safeRpc(() =>
      this.client.rpc('get_integration_event_operations_summary', {
        p_organization_id: parsedOrganizationId
      })
    );
    const rows = summaryRowsSchema.safeParse(response.data);
    if (!rows.success) throw new PersistenceError('Event operations summary invalid');
    const row = rows.data[0];
    return {
      receivedBacklog: row.received_backlog,
      retryDue: row.retry_due,
      processing: row.processing,
      processedRecent: row.processed_recent,
      failed: row.failed,
      retryExhausted: row.retry_exhausted,
      lastRun: row.last_run_id
        ? {
            id: row.last_run_id,
            status: row.last_run_status!,
            errorCode: row.last_run_error_code,
            startedAt: row.last_run_started_at!,
            completedAt: row.last_run_completed_at,
            lastMissedFeedCheckAt: row.last_missed_feed_check_at,
            receivedSelected: row.last_run_received_selected!,
            retrySelected: row.last_run_retry_selected!,
            processed: row.last_run_processed!,
            failed: row.last_run_failed!,
            missedFeedAccepted: row.last_run_missed_feed_accepted!,
            missedFeedDuplicate: row.last_run_missed_feed_duplicate!,
            missedFeedFailureStage: row.last_run_missed_feed_failure_stage,
            providerCallsAttempted: row.last_run_provider_calls_attempted,
            providerCallsSucceeded: row.last_run_provider_calls_succeeded,
            credentialRefreshFailureStage: row.last_run_credential_refresh_failure_stage,
            credentialRefreshCasFailure: row.last_run_credential_refresh_cas_failure,
            credentialRefreshCallsAttempted: row.last_run_credential_refresh_calls_attempted,
            credentialRefreshCallsSucceeded: row.last_run_credential_refresh_calls_succeeded
          }
        : null
    };
  }
}

const startRowsSchema = z
  .array(
    z.object({
      outcome: z.enum(['started', 'already_running', 'not_eligible']),
      run_id: z.uuid().nullable(),
      organization_id: z.string().trim().min(1).max(255).nullable(),
      store_id: z.uuid().nullable(),
      connection_id: z.uuid(),
      missed_feed_due: z.boolean(),
      missed_feed_offset: z.number().int().nonnegative().nullable()
    })
  )
  .length(1);

const finalizeSchema = z
  .object({
    runId: z.uuid(),
    status: z.enum(['succeeded', 'partial', 'failed']),
    counters: integrationEventMaintenanceCountersSchema,
    missedFeedOffset: z.number().int().nonnegative().nullable(),
    lastMissedFeedCheckAt: z.iso.datetime({ offset: true }).nullable(),
    missedFeedFailureStage: missedFeedFailureStageSchema.nullable(),
    credentialRefresh: credentialRefreshDiagnosticsSchema,
    errorCode: z.enum(['event_processing_failed', 'missed_feed_failed']).nullable(),
    errorSummary: z
      .enum([
        'One or more integration events could not be processed',
        'Missed feeds recovery failed safely'
      ])
      .nullable()
  })
  .strict()
  .superRefine((value, context) => {
    const success = value.status === 'succeeded';
    if (success !== (value.errorCode === null && value.errorSummary === null)) {
      context.addIssue({ code: 'custom', message: 'Maintenance terminal error contract invalid' });
    }
    if (
      value.credentialRefresh.failureStage !== null &&
      value.missedFeedFailureStage !== 'credential_resolution'
    ) {
      context.addIssue({ code: 'custom', message: 'Credential refresh context invalid' });
    }
    if (
      success &&
      (value.missedFeedFailureStage !== null ||
        value.credentialRefresh.failureStage !== null ||
        value.credentialRefresh.casFailure !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Successful maintenance diagnostics invalid' });
    }
  });

const checkpointSchema = z
  .object({
    runId: z.uuid(),
    counters: integrationEventMaintenanceCountersSchema,
    missedFeedOffset: z.number().int().nonnegative().nullable(),
    lastMissedFeedCheckAt: z.iso.datetime({ offset: true }).nullable(),
    missedFeedFailureStage: missedFeedFailureStageSchema.nullable(),
    credentialRefresh: credentialRefreshDiagnosticsSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.credentialRefresh.failureStage !== null &&
      value.missedFeedFailureStage !== 'credential_resolution'
    ) {
      context.addIssue({ code: 'custom', message: 'Credential refresh context invalid' });
    }
  });

const nullableTimestamp = z.iso.datetime({ offset: true }).nullable();
const summaryRowsSchema = z
  .array(
    z.object({
      received_backlog: z.number().int().nonnegative(),
      retry_due: z.number().int().nonnegative(),
      processing: z.number().int().nonnegative(),
      processed_recent: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      retry_exhausted: z.number().int().nonnegative(),
      last_run_id: z.uuid().nullable(),
      last_run_status: z.enum(['running', 'succeeded', 'partial', 'failed']).nullable(),
      last_run_error_code: z
        .enum(['event_processing_failed', 'missed_feed_failed', 'maintenance_stale_reclaimed'])
        .nullable(),
      last_run_started_at: nullableTimestamp,
      last_run_completed_at: nullableTimestamp,
      last_missed_feed_check_at: nullableTimestamp,
      last_run_received_selected: z.number().int().nonnegative().nullable(),
      last_run_retry_selected: z.number().int().nonnegative().nullable(),
      last_run_processed: z.number().int().nonnegative().nullable(),
      last_run_failed: z.number().int().nonnegative().nullable(),
      last_run_missed_feed_accepted: z.number().int().nonnegative().nullable(),
      last_run_missed_feed_duplicate: z.number().int().nonnegative().nullable(),
      last_run_missed_feed_failure_stage: missedFeedFailureStageSchema.nullable(),
      last_run_provider_calls_attempted: z.number().int().nonnegative().nullable(),
      last_run_provider_calls_succeeded: z.number().int().nonnegative().nullable(),
      last_run_credential_refresh_failure_stage: credentialRefreshFailureStageSchema.nullable(),
      last_run_credential_refresh_cas_failure: credentialRefreshCasFailureSchema.nullable(),
      last_run_credential_refresh_calls_attempted: z.number().int().nonnegative().nullable(),
      last_run_credential_refresh_calls_succeeded: z.number().int().nonnegative().nullable()
    })
  )
  .length(1);

async function safeRpc(
  operation: () => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ data: unknown }> {
  let response;
  try {
    response = await operation();
  } catch {
    throw new PersistenceError('Integration event maintenance RPC failed');
  }
  if (response.error) throw new PersistenceError('Integration event maintenance failed');
  return response;
}
