import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ListingSyncRunAdminReadModel } from '../recovery-service';
import {
  LISTING_SYNC_RUN_RECOVERY_REASONS,
  LISTING_SYNC_RUN_RECOVERY_SAFE_ERROR,
  ListingSyncRunRecoveryAction,
  canSubmitListingSyncRunRecovery,
  recoveryOutcomeMessage,
  recoveryOutcomeTone,
  recoveryTargetFor
} from './listing-sync-run-recovery-action';

function renderAction(classification: ListingSyncRunAdminReadModel['classification']) {
  const run: ListingSyncRunAdminReadModel = {
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: 'org_a',
    storeId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    kind: 'listing_backfill',
    status: 'running',
    startedAt: '2026-08-27T11:00:00.000Z',
    completedAt: null,
    lastCheckpointAt: '2026-08-27T11:05:00.000Z',
    staleAfterMs: 900000,
    staleBefore: '2026-08-27T11:45:00.000Z',
    stale: true,
    terminalAuditPresent: false,
    classification,
    eligibleTerminalStatuses:
      classification === 'RECOVERABLE_AS_SUCCEEDED'
        ? ['succeeded', 'failed']
        : classification === 'RECOVERABLE_AS_FAILED'
          ? ['failed']
          : [],
    progress: {
      discovered: 1,
      requested: 1,
      fetched: 1,
      persisted: 1,
      failed: 0,
      pages: 1,
      batches: 1
    },
    errorCode: null,
    storeName: 'Main Store',
    connectionProvider: 'mercado-libre',
    connectionExternalAccountId: 'seller-123',
    errorSummary: null
  };
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ListingSyncRunRecoveryAction, { run })
    )
  );
}

describe('listing sync run recovery action policy', () => {
  it('offers only the terminal target authorized by eligibility', () => {
    expect(recoveryTargetFor('RECOVERABLE_AS_SUCCEEDED')).toBe('succeeded');
    expect(recoveryTargetFor('RECOVERABLE_AS_FAILED')).toBe('failed');
    expect(recoveryTargetFor('NOT_RECOVERABLE')).toBeNull();
    expect(recoveryTargetFor('NOT_STALE')).toBeNull();
  });

  it('renders an affordance only for eligible rows', () => {
    expect(renderAction('RECOVERABLE_AS_SUCCEEDED')).toContain('Recover as succeeded');
    expect(renderAction('RECOVERABLE_AS_FAILED')).toContain('Mark as failed');
    expect(renderAction('NOT_RECOVERABLE')).not.toContain('<button');
    expect(renderAction('NOT_STALE')).not.toContain('<button');
  });

  it('prevents a second submission while recovery is pending', () => {
    expect(canSubmitListingSyncRunRecovery(false)).toBe(true);
    expect(canSubmitListingSyncRunRecovery(true)).toBe(false);
  });

  it('uses only the closed 2.20U reason taxonomy', () => {
    expect(LISTING_SYNC_RUN_RECOVERY_REASONS).toEqual([
      'FINALIZE_INTERRUPTED',
      'PROCESS_CRASHED',
      'MANUAL_ABORT',
      'UNKNOWN_EXECUTION_STATE'
    ]);
  });

  it('uses controlled feedback for concurrent and backend outcomes', () => {
    expect(recoveryOutcomeMessage('recovered', 'succeeded')).toBe('Run recovered as succeeded.');
    expect(recoveryOutcomeMessage('already_terminal', 'failed')).toBe(
      'This run was already terminalized.'
    );
    expect(recoveryOutcomeMessage('not_recoverable', 'failed')).toBe(
      'This run is no longer eligible for recovery.'
    );
    expect(recoveryOutcomeTone('recovered')).toBe('success');
    expect(recoveryOutcomeTone('already_terminal')).toBe('info');
    expect(recoveryOutcomeTone('not_stale')).toBe('error');
    expect(LISTING_SYNC_RUN_RECOVERY_SAFE_ERROR).toBe(
      'Recovery could not be completed. The run was not changed.'
    );
  });
});
