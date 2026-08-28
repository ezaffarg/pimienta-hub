import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ListingSyncRunAdminReadModel } from '../recovery-service';
import {
  ListingSyncRunEligibilityBadge,
  ListingSyncRunProgress,
  ListingSyncRunSafeError,
  ListingSyncRunStaleBadge,
  ListingSyncRunStatusBadge,
  ListingSyncRunTimestamp
} from './listing-sync-run-cells';

function adminRun(
  overrides: Partial<ListingSyncRunAdminReadModel> = {}
): ListingSyncRunAdminReadModel {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: 'org_a',
    storeId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    kind: 'listing_backfill',
    status: 'succeeded',
    startedAt: '2026-08-27T11:00:00.000Z',
    completedAt: '2026-08-27T11:05:00.000Z',
    lastCheckpointAt: '2026-08-27T11:05:00.000Z',
    staleAfterMs: 900000,
    staleBefore: '2026-08-27T11:45:00.000Z',
    stale: false,
    terminalAuditPresent: true,
    reconciliationEligible: true,
    classification: 'NOT_RECOVERABLE',
    eligibleTerminalStatuses: [],
    progress: {
      discovered: 1,
      requested: 1,
      fetched: 1,
      persisted: 1,
      failed: 0,
      pages: 1,
      batches: 1,
      missingCandidates: 0,
      reappeared: 0
    },
    errorCode: null,
    storeName: 'Main Store',
    connectionProvider: 'mercado-libre',
    connectionExternalAccountId: 'seller-123',
    errorSummary: null,
    ...overrides
  };
}

describe('listing sync run read-only cells', () => {
  it('renders a succeeded run with progress and stable UTC timestamps', () => {
    const run = adminRun();
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(ListingSyncRunStatusBadge, { status: run.status }),
        createElement(ListingSyncRunTimestamp, { value: run.startedAt }),
        createElement(ListingSyncRunProgress, { run })
      )
    );

    expect(html).toContain('succeeded');
    expect(html).toContain('UTC');
    expect(html).toContain('1 / 1');
    expect(html).toContain('Discovered 1');
    expect(html).toContain('Fetched 1');
  });

  it('renders a running stale run and its technical eligibility as human text', () => {
    const run = adminRun({
      status: 'running',
      completedAt: null,
      stale: true,
      terminalAuditPresent: false,
      classification: 'RECOVERABLE_AS_FAILED',
      eligibleTerminalStatuses: ['failed']
    });
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(ListingSyncRunStaleBadge, { run }),
        createElement(ListingSyncRunEligibilityBadge, {
          classification: run.classification
        })
      )
    );

    expect(html).toContain('STALE');
    expect(html).toContain('Eligible: mark failed');
    expect(html).toContain('RECOVERABLE_AS_FAILED');
  });

  it('shows only the safe failed error and renders no recovery or sync control', () => {
    const run = adminRun({
      status: 'failed',
      errorCode: 'credential_failure',
      errorSummary: 'A valid provider credential was unavailable'
    });
    const html = renderToStaticMarkup(createElement(ListingSyncRunSafeError, { run }));

    expect(html).toContain('credential_failure');
    expect(html).toContain('A valid provider credential was unavailable');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
  });
});
