import 'server-only';

import { z } from 'zod';
import {
  ListingSyncRunRepository,
  listingSyncRunRecoveryReasonSchema,
  type ListingSyncRunRecord,
  type ListingSyncRunRecoveryReason
} from '@/infrastructure/database/listing-sync-run-repository';
import { HubMembershipRepository } from '@/infrastructure/database/repositories';
import {
  AuthorizationDeniedError,
  requirePermission,
  type ApprovedRole
} from '@/lib/auth/authorization';
import { requireServerAuthorizationContext } from '@/lib/auth/server-context';

export const LISTING_SYNC_RUN_STALE_AFTER_MS = 15 * 60 * 1000;

export type ListingSyncRunRecoveryClassification =
  | 'RECOVERABLE_AS_SUCCEEDED'
  | 'RECOVERABLE_AS_FAILED'
  | 'NOT_RECOVERABLE'
  | 'NOT_STALE';

export interface ListingSyncRunRecoveryReadModel {
  id: string;
  organizationId: string;
  storeId: string;
  connectionId: string;
  kind: 'listing_backfill';
  status: ListingSyncRunRecord['status'];
  startedAt: string;
  completedAt: string | null;
  lastCheckpointAt: string;
  staleAfterMs: number;
  staleBefore: string;
  stale: boolean;
  terminalAuditPresent: boolean;
  classification: ListingSyncRunRecoveryClassification;
  eligibleTerminalStatuses: readonly ('succeeded' | 'failed')[];
  progress: {
    discovered: number;
    requested: number;
    fetched: number;
    persisted: number;
    failed: number;
    pages: number;
    batches: number;
  };
  errorCode: ListingSyncRunRecord['errorCode'];
}

export class ListingSyncRunRecoveryError extends Error {
  constructor(public readonly code: 'not_found' | 'recovery_failed') {
    super(code);
    this.name = 'ListingSyncRunRecoveryError';
  }
}

interface RecoveryContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: ApprovedRole;
}

export interface ListingSyncRunRecoveryDependencies {
  now?: () => Date;
  runs?: Pick<ListingSyncRunRepository, 'inspectForRecovery' | 'recoverStale'>;
  memberships?: Pick<HubMembershipRepository, 'findByOrganizationAndClerkUser'>;
  context?: () => Promise<{
    userId: string;
    organizationId: string;
    role: ApprovedRole;
    roleSource: 'persistent' | 'clerk-fallback';
  }>;
}

export async function inspectMercadoLibreListingSyncRunRecovery(
  input: { runId: string },
  dependencies: ListingSyncRunRecoveryDependencies = {}
): Promise<ListingSyncRunRecoveryReadModel> {
  const parsed = recoveryLookupSchema.parse(input);
  const context = await requireRecoveryContext(dependencies);
  const runs = dependencies.runs ?? new ListingSyncRunRepository();
  const inspection = await runs.inspectForRecovery(context.organizationId, parsed.runId);
  if (!inspection) throw new ListingSyncRunRecoveryError('not_found');
  return recoveryReadModel(
    inspection.run,
    inspection.terminalAuditPresent,
    staleBefore(dependencies.now)
  );
}

export async function recoverMercadoLibreListingSyncRun(
  input: {
    runId: string;
    terminalStatus: 'succeeded' | 'failed';
    reason: ListingSyncRunRecoveryReason;
  },
  dependencies: ListingSyncRunRecoveryDependencies = {}
) {
  const parsed = recoveryRequestSchema.parse(input);
  const context = await requireRecoveryContext(dependencies);
  const runs = dependencies.runs ?? new ListingSyncRunRepository();
  const cutoff = staleBefore(dependencies.now);
  try {
    const result = await runs.recoverStale({
      organizationId: context.organizationId,
      runId: parsed.runId,
      recoveryActorMembershipId: context.membershipId,
      terminalStatus: parsed.terminalStatus,
      reason: parsed.reason,
      staleBefore: cutoff
    });
    const inspection = await runs.inspectForRecovery(context.organizationId, parsed.runId);
    if (!inspection) throw new ListingSyncRunRecoveryError('recovery_failed');
    return {
      outcome: result.outcome,
      run: recoveryReadModel(inspection.run, inspection.terminalAuditPresent, cutoff)
    };
  } catch (error) {
    if (error instanceof ListingSyncRunRecoveryError) throw error;
    throw new ListingSyncRunRecoveryError('recovery_failed');
  }
}

async function requireRecoveryContext(
  dependencies: ListingSyncRunRecoveryDependencies
): Promise<RecoveryContext> {
  const context = await (dependencies.context ?? requireServerAuthorizationContext)();
  if (context.roleSource !== 'persistent') throw new AuthorizationDeniedError();
  requirePermission(context.role, 'listings:recover');

  const memberships = dependencies.memberships ?? new HubMembershipRepository();
  const membership = await memberships.findByOrganizationAndClerkUser(
    context.organizationId,
    context.userId
  );
  if (
    !membership ||
    membership.organizationId !== context.organizationId ||
    membership.clerkUserId !== context.userId ||
    membership.role !== context.role
  ) {
    throw new AuthorizationDeniedError();
  }
  return { ...context, membershipId: membership.id };
}

function staleBefore(now: ListingSyncRunRecoveryDependencies['now']): string {
  return new Date(
    (now ?? (() => new Date()))().getTime() - LISTING_SYNC_RUN_STALE_AFTER_MS
  ).toISOString();
}

function recoveryReadModel(
  run: ListingSyncRunRecord,
  terminalAuditPresent: boolean,
  cutoff: string
): ListingSyncRunRecoveryReadModel {
  const stale = run.status === 'running' && run.lastCheckpointAt <= cutoff;
  const canSucceed =
    stale &&
    !terminalAuditPresent &&
    run.lastCheckpointAt > run.startedAt &&
    run.failed === 0 &&
    run.discovered === run.requested &&
    run.requested === run.fetched &&
    run.fetched === run.persisted &&
    run.pages > 0 &&
    ((run.requested === 0 && run.batches === 0) ||
      (run.requested > 0 && run.batches > 0));
  const classification: ListingSyncRunRecoveryClassification =
    run.status !== 'running' || terminalAuditPresent
      ? 'NOT_RECOVERABLE'
      : !stale
        ? 'NOT_STALE'
        : canSucceed
          ? 'RECOVERABLE_AS_SUCCEEDED'
          : 'RECOVERABLE_AS_FAILED';
  return {
    id: run.id,
    organizationId: run.organizationId,
    storeId: run.storeId,
    connectionId: run.connectionId,
    kind: run.kind,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    lastCheckpointAt: run.lastCheckpointAt,
    staleAfterMs: LISTING_SYNC_RUN_STALE_AFTER_MS,
    staleBefore: cutoff,
    stale,
    terminalAuditPresent,
    classification,
    eligibleTerminalStatuses:
      classification === 'RECOVERABLE_AS_SUCCEEDED'
        ? ['succeeded', 'failed']
        : classification === 'RECOVERABLE_AS_FAILED'
          ? ['failed']
          : [],
    progress: {
      discovered: run.discovered,
      requested: run.requested,
      fetched: run.fetched,
      persisted: run.persisted,
      failed: run.failed,
      pages: run.pages,
      batches: run.batches
    },
    errorCode: run.errorCode
  };
}

const recoveryLookupSchema = z.object({ runId: z.uuid() }).strict();
export const listingSyncRunRecoveryRequestSchema = z
  .object({
    terminalStatus: z.enum(['succeeded', 'failed']),
    reason: listingSyncRunRecoveryReasonSchema
  })
  .strict();
const recoveryRequestSchema = listingSyncRunRecoveryRequestSchema.extend({ runId: z.uuid() });
