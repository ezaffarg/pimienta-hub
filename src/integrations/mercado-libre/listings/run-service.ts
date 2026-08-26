import 'server-only';

import { z } from 'zod';
import {
  ListingSyncRunRepository,
  ListingSyncRunStartError,
  type ListingSyncProgress,
  type ListingSyncRunErrorCode,
  type ListingSyncRunRecord,
  type ListingSyncRunStartDiagnostic,
  type ListingSyncRunStartFailureCode
} from '@/infrastructure/database/listing-sync-run-repository';
import { PersistenceError, type ListingScope } from '@/infrastructure/database/repositories';
import { MercadoLibreCredentialError } from '../auth';
import type { CasCompleteFailureCode, RefreshStage } from '../auth/credentials';
import { MercadoLibreListingsError } from './client';
import {
  MercadoLibreListingsService,
  MercadoLibreListingsServiceError,
  type MercadoLibreListingBackfillResult
} from './service';

export type MercadoLibreListingSyncExecutionOutcome = 'executed' | 'reused' | 'already_running';

export interface MercadoLibreListingSyncExecutionResult {
  outcome: MercadoLibreListingSyncExecutionOutcome;
  run: ListingSyncRunRecord;
  backfill: MercadoLibreListingBackfillResult | null;
}

export class MercadoLibreListingSyncRunError extends Error {
  constructor(
    public readonly code: 'run_start_failed' | 'run_finalize_failed',
    public readonly startFailureCode: ListingSyncRunStartFailureCode | null = null,
    public readonly startDiagnostic: ListingSyncRunStartDiagnostic | null = null
  ) {
    super(code);
    this.name = 'MercadoLibreListingSyncRunError';
  }
}

export class MercadoLibreListingSyncRunService {
  constructor(
    private readonly runs = new ListingSyncRunRepository(),
    private readonly listings = new MercadoLibreListingsService()
  ) {}

  async execute(input: {
    organizationId: string;
    storeId: string;
    connectionId: string;
    actorMembershipId: string;
    idempotencyKey: string;
  }): Promise<MercadoLibreListingSyncExecutionResult> {
    const parsed = runInputSchema.parse(input);
    const scope: ListingScope = {
      organizationId: parsed.organizationId,
      storeId: parsed.storeId,
      connectionId: parsed.connectionId
    };
    let started;
    try {
      started = await this.runs.start({
        scope,
        actorMembershipId: parsed.actorMembershipId,
        idempotencyKey: parsed.idempotencyKey
      });
    } catch (error) {
      if (error instanceof ListingSyncRunStartError) {
        throw new MercadoLibreListingSyncRunError('run_start_failed', error.code, error.diagnostic);
      }
      throw new MercadoLibreListingSyncRunError('run_start_failed');
    }

    if (started.outcome !== 'started') {
      return {
        outcome: started.outcome,
        run: started.run,
        backfill: null
      };
    }

    let progress = progressFrom(started.run);
    let backfill: MercadoLibreListingBackfillResult;
    try {
      backfill = await this.listings.syncAllActiveConnectionListings(scope, async (next) => {
        progress = next;
        await this.runs.checkpoint({ scope, runId: started.run.id, progress: next });
      });
    } catch (error) {
      const classified = classifyRunFailure(error);
      const run = await this.finalize({
        scope,
        runId: started.run.id,
        status: 'failed',
        progress,
        errorCode: classified.code,
        errorSummary: classified.summary
      });
      return { outcome: 'executed', run, backfill: null };
    }

    progress = progressFrom(backfill);
    const partial = backfill.failed > 0;
    const run = await this.finalize({
      scope,
      runId: started.run.id,
      status: partial ? 'partial' : 'succeeded',
      progress,
      errorCode: partial ? 'partial_item_failure' : null,
      errorSummary: partial ? safeErrorSummary.partial_item_failure : null
    });
    return { outcome: 'executed', run, backfill };
  }

  private async finalize(
    input: Parameters<ListingSyncRunRepository['finalize']>[0]
  ): Promise<ListingSyncRunRecord> {
    try {
      return await this.runs.finalize(input);
    } catch {
      throw new MercadoLibreListingSyncRunError('run_finalize_failed');
    }
  }
}

const runInputSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(255),
    storeId: z.uuid(),
    connectionId: z.uuid(),
    actorMembershipId: z.uuid(),
    idempotencyKey: z.uuid()
  })
  .strict();

const safeErrorSummary: Readonly<Record<ListingSyncRunErrorCode, string>> = {
  provider_rate_limited: 'The provider rate limit stopped the listing sync',
  provider_timeout: 'The provider timed out during the listing sync',
  provider_unavailable: 'The provider was unavailable during the listing sync',
  invalid_provider_response: 'The provider returned an invalid listing response',
  credential_failure: 'A valid provider credential was unavailable',
  persistence_failure: 'Listing sync persistence failed safely',
  partial_item_failure: 'One or more listing items could not be synchronized'
};
const observableCredentialStages = new Set<RefreshStage>([
  'READ',
  'DECRYPT',
  'CLAIM',
  'DOUBLE_CHECK',
  'PROVIDER_REQUEST',
  'PROVIDER_RESPONSE',
  'ENCRYPT',
  'CAS_COMPLETE'
]);
const observableCasFailures = new Set<CasCompleteFailureCode>([
  'CAS_RPC_THROW',
  'CAS_RPC_ERROR',
  'CAS_RESPONSE_INVALID',
  'CAS_REJECTED'
]);

function classifyRunFailure(error: unknown): {
  code: ListingSyncRunErrorCode;
  summary: string;
} {
  let code: ListingSyncRunErrorCode = 'persistence_failure';
  if (error instanceof MercadoLibreCredentialError) {
    return {
      code: 'credential_failure',
      summary: credentialFailureSummary(error.stage, error.details.casFailure)
    };
  } else if (error instanceof MercadoLibreListingsError) {
    code =
      error.kind === 'provider_rate_limited'
        ? 'provider_rate_limited'
        : error.kind === 'provider_timeout'
          ? 'provider_timeout'
          : error.kind === 'provider_network_error' || error.kind === 'provider_server_error'
            ? 'provider_unavailable'
            : 'invalid_provider_response';
  } else if (
    error instanceof MercadoLibreListingsServiceError ||
    error instanceof PersistenceError
  ) {
    code = 'persistence_failure';
  }
  return { code, summary: safeErrorSummary[code] };
}

function credentialFailureSummary(stage: unknown, casFailure: unknown): string {
  const safeStage = observableCredentialStages.has(stage as RefreshStage)
    ? (stage as RefreshStage)
    : null;
  const safeCasFailure = observableCasFailures.has(casFailure as CasCompleteFailureCode)
    ? (casFailure as CasCompleteFailureCode)
    : null;
  return safeStage
    ? `Credential refresh failed during ${safeStage}${safeStage === 'CAS_COMPLETE' && safeCasFailure ? `/${safeCasFailure}` : ''}`
    : safeErrorSummary.credential_failure;
}

function progressFrom(run: ListingSyncProgress): ListingSyncProgress {
  return {
    discovered: run.discovered,
    requested: run.requested,
    fetched: run.fetched,
    persisted: run.persisted,
    failed: run.failed,
    pages: run.pages,
    batches: run.batches
  };
}
