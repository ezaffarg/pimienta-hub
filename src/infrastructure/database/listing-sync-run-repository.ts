import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSupabaseServerClient } from './supabase-server';
import { PersistenceError, type ListingScope } from './repositories';

export const listingSyncRunStatusSchema = z.enum(['running', 'succeeded', 'partial', 'failed']);
export const listingSyncRunOperationalErrorCodeSchema = z.enum([
  'provider_rate_limited',
  'provider_timeout',
  'provider_unavailable',
  'invalid_provider_response',
  'credential_failure',
  'persistence_failure',
  'partial_item_failure'
]);
export const listingSyncRunErrorCodeSchema = z.union([
  listingSyncRunOperationalErrorCodeSchema,
  z.literal('administrative_recovery')
]);

export type ListingSyncRunStatus = z.infer<typeof listingSyncRunStatusSchema>;
export type ListingSyncRunErrorCode = z.infer<typeof listingSyncRunErrorCodeSchema>;
export type ListingSyncRunOperationalErrorCode = z.infer<
  typeof listingSyncRunOperationalErrorCodeSchema
>;
export type ListingSyncRunStartOutcome = 'started' | 'reused' | 'already_running';
export type ListingSyncRunStartFailureCode =
  | 'RUN_START_RPC_FAILED'
  | 'RUN_START_REJECTED'
  | 'RUN_START_RESPONSE_INVALID'
  | 'RUN_START_MAPPING_FAILED';
export type ListingSyncRunSafeRpcErrorCode =
  | 'P0001'
  | '23503'
  | '23505'
  | '23514'
  | '42501'
  | 'PGRST202';
export type ListingSyncRunTransportClass = 'network' | 'timeout' | 'fetch' | 'client' | 'unknown';

export interface ListingSyncRunStartDiagnostic {
  stage: 'rpc_call' | 'rpc_response' | 'response' | 'mapping';
  thrown: boolean;
  rpcReturnedData: boolean;
  rpcErrorPresent: boolean;
  rpcErrorCode: ListingSyncRunSafeRpcErrorCode | null;
  outcome: ListingSyncRunStartOutcome | null;
  transportClass: ListingSyncRunTransportClass | null;
}

export class ListingSyncRunStartError extends Error {
  constructor(
    public readonly code: ListingSyncRunStartFailureCode,
    public readonly diagnostic: ListingSyncRunStartDiagnostic
  ) {
    super(code);
    this.name = 'ListingSyncRunStartError';
  }
}

export interface ListingSyncProgress {
  discovered: number;
  requested: number;
  fetched: number;
  persisted: number;
  failed: number;
  pages: number;
  batches: number;
}

export interface ListingSyncRunRecord extends ListingScope, ListingSyncProgress {
  id: string;
  actorMembershipId: string;
  kind: 'listing_backfill';
  idempotencyKey: string;
  status: ListingSyncRunStatus;
  startedAt: string;
  completedAt: string | null;
  lastCheckpointAt: string;
  errorCode: ListingSyncRunErrorCode | null;
  errorSummary: string | null;
  updatedAt: string;
}

export interface ListingSyncRunStartResult {
  outcome: ListingSyncRunStartOutcome;
  run: ListingSyncRunRecord;
}

export const listingSyncRunRecoveryReasonSchema = z.enum([
  'FINALIZE_INTERRUPTED',
  'PROCESS_CRASHED',
  'MANUAL_ABORT',
  'UNKNOWN_EXECUTION_STATE'
]);

export type ListingSyncRunRecoveryReason = z.infer<typeof listingSyncRunRecoveryReasonSchema>;
export type ListingSyncRunRecoveryOutcome =
  | 'recovered'
  | 'already_terminal'
  | 'not_stale'
  | 'not_recoverable';

export interface ListingSyncRunRecoveryInspection {
  run: ListingSyncRunRecord;
  terminalAuditPresent: boolean;
}

export interface ListingSyncRunRecoveryResult {
  outcome: ListingSyncRunRecoveryOutcome;
  run: ListingSyncRunRecord;
}

export class ListingSyncRunRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServerClient()) {}

  async start(input: {
    scope: ListingScope;
    actorMembershipId: string;
    idempotencyKey: string;
  }): Promise<ListingSyncRunStartResult> {
    const parsed = startInputSchema.parse(input);
    let response;
    try {
      response = await this.client.rpc('start_listing_sync_run', {
        p_organization_id: parsed.scope.organizationId,
        p_store_id: parsed.scope.storeId,
        p_connection_id: parsed.scope.connectionId,
        p_actor_membership_id: parsed.actorMembershipId,
        p_idempotency_key: parsed.idempotencyKey
      });
    } catch (error) {
      throw new ListingSyncRunStartError('RUN_START_RPC_FAILED', {
        stage: 'rpc_call',
        thrown: true,
        rpcReturnedData: false,
        rpcErrorPresent: false,
        rpcErrorCode: null,
        outcome: null,
        transportClass: classifyRpcThrow(error)
      });
    }
    const { data, error } = response;
    const safeRpcErrorCode = safeRpcErrorCodeSchema.safeParse(error?.code).data ?? null;
    if (error) {
      throw new ListingSyncRunStartError(
        safeRpcErrorCode !== null && rejectedRpcErrorCodes.has(safeRpcErrorCode)
          ? 'RUN_START_REJECTED'
          : 'RUN_START_RPC_FAILED',
        {
          stage: 'rpc_response',
          thrown: false,
          rpcReturnedData: data != null,
          rpcErrorPresent: true,
          rpcErrorCode: safeRpcErrorCode,
          outcome: null,
          transportClass: null
        }
      );
    }

    const rows = z.array(z.record(z.string(), z.unknown())).length(1).safeParse(data);
    if (!rows.success) {
      throw new ListingSyncRunStartError('RUN_START_RESPONSE_INVALID', {
        stage: 'response',
        thrown: false,
        rpcReturnedData: data != null,
        rpcErrorPresent: false,
        rpcErrorCode: null,
        outcome: null,
        transportClass: null
      });
    }

    const row = rows.data[0];
    const outcome = listingSyncRunStartOutcomeSchema.safeParse(row?.outcome);
    try {
      if (!row || !outcome.success) throw new Error('invalid start outcome');
      return { outcome: outcome.data, run: listingSyncRunRecord(row) };
    } catch {
      throw new ListingSyncRunStartError('RUN_START_MAPPING_FAILED', {
        stage: 'mapping',
        thrown: false,
        rpcReturnedData: true,
        rpcErrorPresent: false,
        rpcErrorCode: null,
        outcome: outcome.success ? outcome.data : null,
        transportClass: null
      });
    }
  }

  async get(scope: ListingScope, runId: string): Promise<ListingSyncRunRecord | null> {
    const parsed = z
      .object({ scope: listingScopeSchema, runId: z.uuid() })
      .strict()
      .parse({ scope, runId });
    const { data, error } = await this.client
      .from('listing_sync_runs')
      .select(listingSyncRunColumns)
      .eq('id', parsed.runId)
      .eq('organization_id', parsed.scope.organizationId)
      .eq('store_id', parsed.scope.storeId)
      .eq('connection_id', parsed.scope.connectionId)
      .maybeSingle();
    if (error) throw new PersistenceError('Listing sync run lookup failed');
    return data ? listingSyncRunRecord(data) : null;
  }

  async inspectForRecovery(
    organizationId: string,
    runId: string
  ): Promise<ListingSyncRunRecoveryInspection | null> {
    const parsed = recoveryLookupSchema.parse({ organizationId, runId });
    const { data, error } = await this.client
      .from('listing_sync_runs')
      .select(listingSyncRunColumns)
      .eq('id', parsed.runId)
      .eq('organization_id', parsed.organizationId)
      .maybeSingle();
    if (error) throw new PersistenceError('Listing sync run recovery inspection failed');
    if (!data) return null;

    const auditResponse = await this.client
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', parsed.organizationId)
      .eq('resource_type', 'listing_sync_run')
      .eq('resource_id', parsed.runId)
      .in('action', terminalAuditActions);
    if (auditResponse.error) {
      throw new PersistenceError('Listing sync run recovery inspection failed');
    }
    return {
      run: listingSyncRunRecord(data),
      terminalAuditPresent: (auditResponse.count ?? 0) > 0
    };
  }

  async listRecentForRecovery(
    organizationId: string,
    limit: number
  ): Promise<ListingSyncRunRecoveryInspection[]> {
    const parsed = recoveryListSchema.parse({ organizationId, limit });
    const { data, error } = await this.client
      .from('listing_sync_runs')
      .select(listingSyncRunColumns)
      .eq('organization_id', parsed.organizationId)
      .order('started_at', { ascending: false })
      .limit(parsed.limit);
    if (error) throw new PersistenceError('Listing sync run recovery list failed');

    const runs = z.array(runRowSchema).parse(data).map(listingSyncRunRecord);
    if (runs.length === 0) return [];

    const auditResponse = await this.client
      .from('audit_events')
      .select('resource_id')
      .eq('organization_id', parsed.organizationId)
      .eq('resource_type', 'listing_sync_run')
      .in(
        'resource_id',
        runs.map((run) => run.id)
      )
      .in('action', terminalAuditActions);
    if (auditResponse.error) throw new PersistenceError('Listing sync run recovery list failed');

    const terminalRunIds = new Set(
      z
        .array(z.object({ resource_id: z.string().uuid() }))
        .parse(auditResponse.data)
        .map((audit) => audit.resource_id)
    );
    return runs.map((run) => ({ run, terminalAuditPresent: terminalRunIds.has(run.id) }));
  }

  async recoverStale(input: {
    organizationId: string;
    runId: string;
    recoveryActorMembershipId: string;
    terminalStatus: 'succeeded' | 'failed';
    reason: ListingSyncRunRecoveryReason;
    staleBefore: string;
  }): Promise<ListingSyncRunRecoveryResult> {
    const parsed = recoveryInputSchema.parse(input);
    let response;
    try {
      response = await this.client.rpc('recover_stale_listing_sync_run', {
        p_organization_id: parsed.organizationId,
        p_run_id: parsed.runId,
        p_recovery_actor_membership_id: parsed.recoveryActorMembershipId,
        p_terminal_status: parsed.terminalStatus,
        p_recovery_reason: parsed.reason,
        p_stale_before: parsed.staleBefore
      });
    } catch {
      throw new PersistenceError('Listing sync run recovery RPC failed');
    }
    if (response.error) throw new PersistenceError('Listing sync run recovery failed');
    const rows = recoveryRowsSchema.safeParse(response.data);
    if (!rows.success) throw new PersistenceError('Listing sync run recovery response invalid');
    const row = rows.data[0];
    return { outcome: row.outcome, run: listingSyncRunRecord(row) };
  }

  async checkpoint(input: {
    scope: ListingScope;
    runId: string;
    progress: ListingSyncProgress;
  }): Promise<ListingSyncRunRecord> {
    const parsed = progressInputSchema.parse(input);
    let response;
    try {
      response = await this.client.rpc('checkpoint_listing_sync_run', {
        p_organization_id: parsed.scope.organizationId,
        p_store_id: parsed.scope.storeId,
        p_connection_id: parsed.scope.connectionId,
        p_run_id: parsed.runId,
        ...progressRpcArguments(parsed.progress)
      });
    } catch {
      throw new PersistenceError('Listing sync run checkpoint RPC failed');
    }
    const { data, error } = response;
    return listingSyncRunRecord(requireRpcRow(data, error));
  }

  async finalize(input: {
    scope: ListingScope;
    runId: string;
    status: Exclude<ListingSyncRunStatus, 'running'>;
    progress: ListingSyncProgress;
    errorCode?: ListingSyncRunOperationalErrorCode | null;
    errorSummary?: string | null;
  }): Promise<ListingSyncRunRecord> {
    const parsed = finalizeInputSchema.parse(input);
    let response;
    try {
      response = await this.client.rpc('finalize_listing_sync_run', {
        p_organization_id: parsed.scope.organizationId,
        p_store_id: parsed.scope.storeId,
        p_connection_id: parsed.scope.connectionId,
        p_run_id: parsed.runId,
        p_status: parsed.status,
        ...progressRpcArguments(parsed.progress),
        p_error_code: parsed.errorCode ?? null,
        p_error_summary: parsed.errorSummary ?? null
      });
    } catch {
      throw new PersistenceError('Listing sync run finalize RPC failed');
    }
    const { data, error } = response;
    return listingSyncRunRecord(requireRpcRow(data, error));
  }
}

const counterSchema = z.number().int().nonnegative();
const listingSyncRunStartOutcomeSchema = z.enum(['started', 'reused', 'already_running']);
const safeRpcErrorCodeSchema = z.enum(['P0001', '23503', '23505', '23514', '42501', 'PGRST202']);
const rejectedRpcErrorCodes = new Set<ListingSyncRunSafeRpcErrorCode>([
  'P0001',
  '23503',
  '23505',
  '23514'
]);
const progressSchema = z
  .object({
    discovered: counterSchema,
    requested: counterSchema,
    fetched: counterSchema,
    persisted: counterSchema,
    failed: counterSchema,
    pages: counterSchema,
    batches: counterSchema
  })
  .strict();
const listingScopeSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    storeId: z.uuid(),
    connectionId: z.uuid()
  })
  .strict();
const recoveryLookupSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    runId: z.uuid()
  })
  .strict();
const recoveryListSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    limit: z.number().int().min(1).max(100)
  })
  .strict();
const startInputSchema = z
  .object({
    scope: listingScopeSchema,
    actorMembershipId: z.uuid(),
    idempotencyKey: z.uuid()
  })
  .strict();
const progressInputSchema = z
  .object({
    scope: listingScopeSchema,
    runId: z.uuid(),
    progress: progressSchema
  })
  .strict();
const finalizeInputSchema = z
  .object({
    scope: listingScopeSchema,
    runId: z.uuid(),
    status: z.enum(['succeeded', 'partial', 'failed']),
    progress: progressSchema,
    errorCode: listingSyncRunOperationalErrorCodeSchema.nullish(),
    errorSummary: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          !/(access[_ -]?token|refresh[_ -]?token|authorization|cookie|password|secret)/i.test(
            value
          ),
        'Listing sync error summary contains prohibited material'
      )
      .nullish()
  })
  .strict()
  .superRefine((value, context) => {
    const hasError = value.errorCode != null || value.errorSummary != null;
    if (value.status === 'succeeded' && hasError) {
      context.addIssue({
        code: 'custom',
        message: 'Succeeded runs cannot contain errors'
      });
    }
    if (value.status !== 'succeeded' && value.errorCode == null) {
      context.addIssue({
        code: 'custom',
        message: 'Partial and failed runs require an error code'
      });
    }
  });

const recoveryInputSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    runId: z.uuid(),
    recoveryActorMembershipId: z.uuid(),
    terminalStatus: z.enum(['succeeded', 'failed']),
    reason: listingSyncRunRecoveryReasonSchema,
    staleBefore: z.iso.datetime({ offset: true })
  })
  .strict();

const timestampSchema = z.iso.datetime({ offset: true });
const runRowSchema = z.object({
  id: z.uuid(),
  organization_id: z.string().trim().min(1).max(255),
  store_id: z.uuid(),
  connection_id: z.uuid(),
  actor_membership_id: z.uuid(),
  kind: z.literal('listing_backfill'),
  idempotency_key: z.uuid(),
  status: listingSyncRunStatusSchema,
  started_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
  last_checkpoint_at: timestampSchema,
  discovered_count: counterSchema,
  requested_count: counterSchema,
  fetched_count: counterSchema,
  persisted_count: counterSchema,
  failed_count: counterSchema,
  pages_count: counterSchema,
  batches_count: counterSchema,
  error_code: listingSyncRunErrorCodeSchema.nullable(),
  error_summary: z.string().max(512).nullable(),
  updated_at: timestampSchema
});

const recoveryRowsSchema = z
  .array(
    runRowSchema.extend({
      outcome: z.enum(['recovered', 'already_terminal', 'not_stale', 'not_recoverable'])
    })
  )
  .length(1);

const terminalAuditActions = [
  'listing.sync.succeeded',
  'listing.sync.partial',
  'listing.sync.failed'
] as const;

const listingSyncRunColumns =
  'id, organization_id, store_id, connection_id, actor_membership_id, kind, idempotency_key, status, started_at, completed_at, last_checkpoint_at, discovered_count, requested_count, fetched_count, persisted_count, failed_count, pages_count, batches_count, error_code, error_summary, updated_at';

function listingSyncRunRecord(input: unknown): ListingSyncRunRecord {
  const row = runRowSchema.parse(input);
  return {
    id: row.id,
    organizationId: row.organization_id,
    storeId: row.store_id,
    connectionId: row.connection_id,
    actorMembershipId: row.actor_membership_id,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastCheckpointAt: row.last_checkpoint_at,
    discovered: row.discovered_count,
    requested: row.requested_count,
    fetched: row.fetched_count,
    persisted: row.persisted_count,
    failed: row.failed_count,
    pages: row.pages_count,
    batches: row.batches_count,
    errorCode: row.error_code,
    errorSummary: row.error_summary,
    updatedAt: row.updated_at
  };
}

function requireRpcRow(data: unknown, error: { message: string } | null): Record<string, unknown> {
  if (error) throw new PersistenceError('Listing sync run persistence operation failed');
  const row = z.array(z.record(z.string(), z.unknown())).min(1).parse(data)[0];
  if (!row) throw new PersistenceError('The listing sync run RPC returned no data');
  return row;
}

function progressRpcArguments(progress: ListingSyncProgress) {
  return {
    p_discovered_count: progress.discovered,
    p_requested_count: progress.requested,
    p_fetched_count: progress.fetched,
    p_persisted_count: progress.persisted,
    p_failed_count: progress.failed,
    p_pages_count: progress.pages,
    p_batches_count: progress.batches
  };
}

function classifyRpcThrow(error: unknown): ListingSyncRunTransportClass {
  const value = typeof error === 'object' && error !== null ? error : null;
  const cause =
    value && 'cause' in value && typeof value.cause === 'object' && value.cause !== null
      ? value.cause
      : null;
  const code =
    value && 'code' in value && typeof value.code === 'string'
      ? value.code
      : cause && 'code' in cause && typeof cause.code === 'string'
        ? cause.code
        : null;
  const name = error instanceof Error ? error.name : null;

  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return 'timeout';
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN'
  ) {
    return 'network';
  }
  if (error instanceof TypeError && error.message.toLowerCase().startsWith('fetch failed')) {
    return 'fetch';
  }
  if (name === 'PostgrestError') return 'client';
  return 'unknown';
}
