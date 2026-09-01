import 'server-only';

import { z } from 'zod';
import {
  ListingSyncRunRepository,
  listingSyncRunRecoveryReasonSchema,
  type ListingSyncRunRecord,
  type ListingSyncRunRecoveryReason
} from '@/infrastructure/database/listing-sync-run-repository';
import {
  ConnectionRepository,
  HubMembershipRepository,
  StoreRepository,
  type ConnectionRecord,
  type StoreRecord
} from '@/infrastructure/database/repositories';
import {
  AuthorizationDeniedError,
  requirePermission,
  type ApprovedRole
} from '@/lib/auth/authorization';
import { requireServerAuthorizationContext } from '@/lib/auth/server-context';

export const LISTING_SYNC_RUN_STALE_AFTER_MS = 15 * 60 * 1000;
export const LISTING_SYNC_RUN_ADMIN_SCAN_LIMIT = 50;

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
  reconciliationEligible: boolean;
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
    missingCandidates: number;
    reappeared: number;
  };
  errorCode: ListingSyncRunRecord['errorCode'];
}

export interface ListingSyncRunAdminReadModel extends ListingSyncRunRecoveryReadModel {
  storeName: string;
  connectionProvider: 'mercado-libre';
  connectionExternalAccountId: string | null;
  errorSummary: string | null;
}

export interface ListingSyncRunAdminListResponse {
  runs: ListingSyncRunAdminReadModel[];
  total: number;
  page: number;
  limit: number;
  scanLimit: number;
  stores: { id: string; name: string }[];
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
  runs?: Pick<
    ListingSyncRunRepository,
    'inspectForRecovery' | 'listRecentForRecovery' | 'recoverStale'
  >;
  memberships?: Pick<HubMembershipRepository, 'findByOrganizationAndClerkUser'>;
  stores?: Pick<StoreRepository, 'listByOrganizationAndIds'>;
  connections?: Pick<ConnectionRepository, 'listByOrganizationAndIds'>;
  context?: () => Promise<{
    userId: string;
    organizationId: string;
    role: ApprovedRole;
    roleSource: 'persistent' | 'clerk-fallback';
  }>;
}

const listingSyncRunStatusValues = ['running', 'succeeded', 'partial', 'failed'] as const;
const listingSyncRunRecoveryClassificationValues = [
  'RECOVERABLE_AS_SUCCEEDED',
  'RECOVERABLE_AS_FAILED',
  'NOT_RECOVERABLE',
  'NOT_STALE'
] as const;
const adminSortSchema = z.object({
  id: z.enum(['status', 'startedAt', 'lastCheckpointAt', 'completedAt']),
  desc: z.boolean()
});
type AdminSort = z.infer<typeof adminSortSchema>;
const commaSeparatedUuidFilter = z
  .string()
  .max(2048)
  .refine((value) =>
    value
      .split(',')
      .filter(Boolean)
      .every((item) => z.uuid().safeParse(item).success)
  );

export const listingSyncRunAdminListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    status: commaSeparatedFilter(listingSyncRunStatusValues).optional(),
    storeId: commaSeparatedUuidFilter.optional(),
    stale: z.enum(['true', 'false']).optional(),
    eligibility: commaSeparatedFilter(listingSyncRunRecoveryClassificationValues).optional(),
    sort: z
      .string()
      .max(256)
      .refine((value) => parseAdminSort(value) !== null, 'Invalid listing sync run sort')
      .optional()
  })
  .strict();

export type ListingSyncRunAdminListQuery = z.infer<typeof listingSyncRunAdminListQuerySchema>;

export async function listMercadoLibreListingSyncRuns(
  input: ListingSyncRunAdminListQuery,
  dependencies: ListingSyncRunRecoveryDependencies = {}
): Promise<ListingSyncRunAdminListResponse> {
  const parsed = listingSyncRunAdminListQuerySchema.parse(input);
  const context = await requireRecoveryContext(dependencies);
  const runs = dependencies.runs ?? new ListingSyncRunRepository();
  const inspections = await runs.listRecentForRecovery(
    context.organizationId,
    LISTING_SYNC_RUN_ADMIN_SCAN_LIMIT
  );
  const storeIds = [...new Set(inspections.map(({ run }) => run.storeId))];
  const connectionIds = [...new Set(inspections.map(({ run }) => run.connectionId))];
  const stores = dependencies.stores ?? new StoreRepository();
  const connections = dependencies.connections ?? new ConnectionRepository();
  const [storeRecords, connectionRecords] = await Promise.all([
    stores.listByOrganizationAndIds(context.organizationId, storeIds),
    connections.listByOrganizationAndIds(context.organizationId, connectionIds)
  ]);
  const storeById = new Map(storeRecords.map((store) => [store.id, store]));
  const connectionById = new Map(
    connectionRecords.map((connection) => [connection.id, connection])
  );
  const cutoff = staleBefore(dependencies.now);
  const adminRuns = inspections.map(({ run, terminalAuditPresent }) =>
    adminReadModel(
      run,
      terminalAuditPresent,
      cutoff,
      storeById.get(run.storeId),
      connectionById.get(run.connectionId)
    )
  );
  const filtered = filterAdminRuns(adminRuns, parsed);
  const sorted = sortAdminRuns(filtered, parsed.sort);
  const offset = (parsed.page - 1) * parsed.limit;

  return {
    runs: sorted.slice(offset, offset + parsed.limit),
    total: sorted.length,
    page: parsed.page,
    limit: parsed.limit,
    scanLimit: LISTING_SYNC_RUN_ADMIN_SCAN_LIMIT,
    stores: storeRecords
      .map((store) => ({ id: store.id, name: store.name }))
      .toSorted((left, right) => left.name.localeCompare(right.name))
  };
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
    ((run.requested === 0 && run.batches === 0) || (run.requested > 0 && run.batches > 0));
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
    reconciliationEligible: run.reconciliationEligible,
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
      batches: run.batches,
      missingCandidates: run.missingCandidateCount,
      reappeared: run.reappearedCount
    },
    errorCode: run.errorCode
  };
}

function adminReadModel(
  run: ListingSyncRunRecord,
  terminalAuditPresent: boolean,
  cutoff: string,
  store: StoreRecord | undefined,
  connection: ConnectionRecord | undefined
): ListingSyncRunAdminReadModel {
  if (
    !store ||
    store.organizationId !== run.organizationId ||
    !connection ||
    connection.organizationId !== run.organizationId ||
    connection.storeId !== run.storeId ||
    connection.provider !== 'mercado-libre'
  ) {
    throw new ListingSyncRunRecoveryError('recovery_failed');
  }
  return {
    ...recoveryReadModel(run, terminalAuditPresent, cutoff),
    storeName: store.name,
    connectionProvider: connection.provider,
    connectionExternalAccountId: connection.externalAccountId,
    errorSummary: safeAdminErrorSummary(run.errorSummary)
  };
}

function filterAdminRuns(
  runs: ListingSyncRunAdminReadModel[],
  query: ListingSyncRunAdminListQuery
): ListingSyncRunAdminReadModel[] {
  const statuses = splitFilter(query.status);
  const storeIds = splitFilter(query.storeId);
  const eligibility = splitFilter(query.eligibility);
  const stale = query.stale === undefined ? null : query.stale === 'true';
  return runs.filter(
    (run) =>
      (statuses.length === 0 || statuses.includes(run.status)) &&
      (storeIds.length === 0 || storeIds.includes(run.storeId)) &&
      (eligibility.length === 0 || eligibility.includes(run.classification)) &&
      (stale === null || (run.status === 'running' && run.stale === stale))
  );
}

function safeAdminErrorSummary(summary: string | null): string | null {
  if (!summary) return null;
  return safeAdminErrorSummaries.has(summary) || safeCredentialErrorSummary.test(summary)
    ? summary
    : null;
}

const safeAdminErrorSummaries = new Set([
  'The provider rate limit stopped the listing sync',
  'The provider timed out during the listing sync',
  'The provider was unavailable during the listing sync',
  'The provider returned an invalid listing response',
  'A valid provider credential was unavailable',
  'Listing sync persistence failed safely',
  'One or more listing items could not be synchronized'
]);
const safeCredentialErrorSummary =
  /^Credential refresh failed during (READ|DECRYPT|CLAIM|DOUBLE_CHECK|PROVIDER_REQUEST|PROVIDER_RESPONSE|ENCRYPT|CAS_COMPLETE(?:\/(?:CAS_RPC_THROW|CAS_RPC_ERROR|CAS_RESPONSE_INVALID|CAS_CONFLICT|CAS_REJECTED))?)$/;

function sortAdminRuns(
  runs: ListingSyncRunAdminReadModel[],
  serializedSort: string | undefined
): ListingSyncRunAdminReadModel[] {
  const sort = serializedSort ? parseAdminSort(serializedSort) : null;
  const field = sort?.id ?? 'startedAt';
  const direction = (sort?.desc ?? true) ? -1 : 1;
  return runs.toSorted((left, right) => {
    const leftValue = left[field] ?? '';
    const rightValue = right[field] ?? '';
    return String(leftValue).localeCompare(String(rightValue)) * direction;
  });
}

function parseAdminSort(value: string): AdminSort | null {
  try {
    const parsed = z.array(adminSortSchema).max(1).safeParse(JSON.parse(value));
    return parsed.success ? (parsed.data[0] ?? null) : null;
  } catch {
    return null;
  }
}

function splitFilter(value: string | undefined): string[] {
  return value?.split(',').filter(Boolean) ?? [];
}

function commaSeparatedFilter<const T extends readonly [string, ...string[]]>(values: T) {
  const itemSchema = z.enum(values);
  return z
    .string()
    .max(512)
    .refine((value) =>
      value
        .split(',')
        .filter(Boolean)
        .every((item) => itemSchema.safeParse(item).success)
    );
}

const recoveryLookupSchema = z.object({ runId: z.uuid() }).strict();
export const listingSyncRunRecoveryRequestSchema = z
  .object({
    terminalStatus: z.enum(['succeeded', 'failed']),
    reason: listingSyncRunRecoveryReasonSchema
  })
  .strict();
const recoveryRequestSchema = listingSyncRunRecoveryRequestSchema.extend({ runId: z.uuid() });
