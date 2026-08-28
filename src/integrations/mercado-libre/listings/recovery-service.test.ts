import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { AuthorizationDeniedError, type ApprovedRole } from '@/lib/auth/authorization';
import {
  inspectMercadoLibreListingSyncRunRecovery,
  LISTING_SYNC_RUN_STALE_AFTER_MS,
  listMercadoLibreListingSyncRuns,
  recoverMercadoLibreListingSyncRun
} from './recovery-service';

const runId = '55555555-5555-4555-8555-555555555555';
const membershipId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-08-27T12:00:00.000Z');

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: runId,
    organizationId: 'org_a',
    storeId: '11111111-1111-4111-8111-111111111111',
    connectionId: '22222222-2222-4222-8222-222222222222',
    actorMembershipId: '44444444-4444-4444-8444-444444444444',
    kind: 'listing_backfill' as const,
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    status: 'running' as const,
    startedAt: '2026-08-27T11:00:00.000Z',
    completedAt: null,
    lastCheckpointAt: '2026-08-27T11:30:00.000Z',
    discovered: 1,
    requested: 1,
    fetched: 1,
    persisted: 1,
    failed: 0,
    pages: 1,
    batches: 1,
    errorCode: null,
    errorSummary: null,
    reconciliationEligible: false,
    missingCandidateCount: 0,
    reappearedCount: 0,
    updatedAt: '2026-08-27T11:30:00.000Z',
    ...overrides
  };
}

function dependencies(role: ApprovedRole = 'Owner') {
  return {
    now: () => now,
    context: vi.fn().mockResolvedValue({
      userId: 'user_a',
      organizationId: 'org_a',
      role,
      roleSource: 'persistent' as const
    }),
    memberships: {
      findByOrganizationAndClerkUser: vi.fn().mockResolvedValue({
        id: membershipId,
        organizationId: 'org_a',
        clerkUserId: 'user_a',
        role
      })
    },
    runs: {
      inspectForRecovery: vi.fn().mockResolvedValue({
        run: run(),
        terminalAuditPresent: false
      }),
      listRecentForRecovery: vi
        .fn()
        .mockResolvedValue([{ run: run(), terminalAuditPresent: false }]),
      recoverStale: vi.fn().mockResolvedValue({ outcome: 'recovered', run: run() })
    },
    stores: {
      listByOrganizationAndIds: vi.fn().mockResolvedValue([
        {
          id: '11111111-1111-4111-8111-111111111111',
          organizationId: 'org_a',
          name: 'Main Store',
          status: 'active'
        }
      ])
    },
    connections: {
      listByOrganizationAndIds: vi.fn().mockResolvedValue([
        {
          id: '22222222-2222-4222-8222-222222222222',
          organizationId: 'org_a',
          storeId: '11111111-1111-4111-8111-111111111111',
          provider: 'mercado-libre',
          externalAccountId: 'seller-123',
          status: 'active',
          scopes: [],
          expiresAt: null
        }
      ])
    }
  };
}

describe('administrative listing sync run recovery', () => {
  it.each(['Owner', 'Manager'] as const)(
    'lists recent runs for a persistent %s with DB-only display enrichment',
    async (role) => {
      const deps = dependencies(role);

      await expect(
        listMercadoLibreListingSyncRuns({ page: 1, limit: 10 }, deps)
      ).resolves.toMatchObject({
        total: 1,
        runs: [
          {
            id: runId,
            storeName: 'Main Store',
            connectionProvider: 'mercado-libre',
            connectionExternalAccountId: 'seller-123',
            stale: true,
            classification: 'RECOVERABLE_AS_SUCCEEDED'
          }
        ]
      });
      expect(deps.runs.listRecentForRecovery).toHaveBeenCalledWith('org_a', 50);
      expect(deps.stores.listByOrganizationAndIds).toHaveBeenCalledOnce();
      expect(deps.connections.listByOrganizationAndIds).toHaveBeenCalledOnce();
    }
  );

  it.each(['Employee', 'Client'] as const)(
    'denies %s before listing or enrichment',
    async (role) => {
      const deps = dependencies(role);

      await expect(
        listMercadoLibreListingSyncRuns({ page: 1, limit: 10 }, deps)
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      expect(deps.runs.listRecentForRecovery).not.toHaveBeenCalled();
      expect(deps.stores.listByOrganizationAndIds).not.toHaveBeenCalled();
      expect(deps.connections.listByOrganizationAndIds).not.toHaveBeenCalled();
    }
  );

  it('filters and paginates the bounded admin read model without provider work', async () => {
    const deps = dependencies();
    deps.runs.listRecentForRecovery.mockResolvedValue([
      {
        run: run({
          status: 'succeeded',
          completedAt: '2026-08-27T11:40:00.000Z',
          errorCode: null,
          errorSummary: null
        }),
        terminalAuditPresent: true
      },
      {
        run: run({
          id: '77777777-7777-4777-8777-777777777777',
          status: 'failed',
          completedAt: '2026-08-27T11:35:00.000Z',
          errorCode: 'credential_failure',
          errorSummary: 'A valid provider credential was unavailable'
        }),
        terminalAuditPresent: true
      }
    ]);

    await expect(
      listMercadoLibreListingSyncRuns(
        { page: 1, limit: 10, status: 'failed', eligibility: 'NOT_RECOVERABLE' },
        deps
      )
    ).resolves.toMatchObject({
      total: 1,
      runs: [
        {
          status: 'failed',
          errorCode: 'credential_failure',
          errorSummary: 'A valid provider credential was unavailable'
        }
      ]
    });
  });

  it('redacts a prohibited legacy error summary before it reaches the admin UI', async () => {
    const deps = dependencies();
    deps.runs.listRecentForRecovery.mockResolvedValue([
      {
        run: run({
          status: 'failed',
          completedAt: '2026-08-27T11:35:00.000Z',
          errorCode: 'credential_failure',
          errorSummary: 'access_token=must-not-render'
        }),
        terminalAuditPresent: true
      }
    ]);

    await expect(
      listMercadoLibreListingSyncRuns({ page: 1, limit: 10 }, deps)
    ).resolves.toMatchObject({ runs: [{ errorSummary: null }] });
  });

  it('redacts a non-canonical SQL-like legacy summary before it reaches the admin UI', async () => {
    const deps = dependencies();
    deps.runs.listRecentForRecovery.mockResolvedValue([
      {
        run: run({
          status: 'failed',
          completedAt: '2026-08-27T11:35:00.000Z',
          errorCode: 'persistence_failure',
          errorSummary: 'duplicate key violates unique constraint listings_external_listing_id_key'
        }),
        terminalAuditPresent: true
      }
    ]);

    await expect(
      listMercadoLibreListingSyncRuns({ page: 1, limit: 10 }, deps)
    ).resolves.toMatchObject({ runs: [{ errorSummary: null }] });
  });

  it.each(['Owner', 'Manager'] as const)(
    'allows a persistent %s and exposes a safe deterministic read model',
    async (role) => {
      const deps = dependencies(role);

      await expect(
        inspectMercadoLibreListingSyncRunRecovery({ runId }, deps)
      ).resolves.toMatchObject({
        id: runId,
        stale: true,
        staleAfterMs: LISTING_SYNC_RUN_STALE_AFTER_MS,
        classification: 'RECOVERABLE_AS_SUCCEEDED',
        eligibleTerminalStatuses: ['succeeded', 'failed'],
        progress: { persisted: 1, failed: 0 }
      });
      expect(deps.runs.inspectForRecovery).toHaveBeenCalledWith('org_a', runId);
    }
  );

  it.each(['Employee', 'Client'] as const)('denies %s before inspecting a run', async (role) => {
    const deps = dependencies(role);

    await expect(inspectMercadoLibreListingSyncRunRecovery({ runId }, deps)).rejects.toBeInstanceOf(
      AuthorizationDeniedError
    );
    expect(deps.runs.inspectForRecovery).not.toHaveBeenCalled();
  });

  it('denies Clerk fallback and a mismatched persistent membership', async () => {
    const fallback = dependencies();
    fallback.context.mockResolvedValue({
      userId: 'user_a',
      organizationId: 'org_a',
      role: 'Owner',
      roleSource: 'clerk-fallback'
    });
    await expect(
      inspectMercadoLibreListingSyncRunRecovery({ runId }, fallback)
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    const mismatch = dependencies();
    mismatch.memberships.findByOrganizationAndClerkUser.mockResolvedValue({
      id: membershipId,
      organizationId: 'org_b',
      clerkUserId: 'user_a',
      role: 'Owner'
    });
    await expect(
      inspectMercadoLibreListingSyncRunRecovery({ runId }, mismatch)
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it('treats the exact inactivity boundary as stale and a newer checkpoint as not stale', async () => {
    const atBoundary = dependencies();
    atBoundary.runs.inspectForRecovery.mockResolvedValue({
      run: run({ lastCheckpointAt: '2026-08-27T11:45:00.000Z' }),
      terminalAuditPresent: false
    });
    await expect(
      inspectMercadoLibreListingSyncRunRecovery({ runId }, atBoundary)
    ).resolves.toMatchObject({ stale: true, classification: 'RECOVERABLE_AS_SUCCEEDED' });

    const fresh = dependencies();
    fresh.runs.inspectForRecovery.mockResolvedValue({
      run: run({ lastCheckpointAt: '2026-08-27T11:45:00.001Z' }),
      terminalAuditPresent: false
    });
    await expect(
      inspectMercadoLibreListingSyncRunRecovery({ runId }, fresh)
    ).resolves.toMatchObject({ stale: false, classification: 'NOT_STALE' });
  });

  it('only permits failed recovery when checkpoint evidence is incomplete', async () => {
    const deps = dependencies();
    deps.runs.inspectForRecovery.mockResolvedValue({
      run: run({ fetched: 0, persisted: 0 }),
      terminalAuditPresent: false
    });

    await expect(inspectMercadoLibreListingSyncRunRecovery({ runId }, deps)).resolves.toMatchObject(
      {
        classification: 'RECOVERABLE_AS_FAILED',
        eligibleTerminalStatuses: ['failed']
      }
    );
  });

  it.each(['succeeded', 'partial', 'failed'] as const)(
    'classifies an already %s run as not recoverable',
    async (status) => {
      const terminal = dependencies();
      terminal.runs.inspectForRecovery.mockResolvedValue({
        run: run({ status, completedAt: '2026-08-27T11:40:00.000Z' }),
        terminalAuditPresent: true
      });
      await expect(
        inspectMercadoLibreListingSyncRunRecovery({ runId }, terminal)
      ).resolves.toMatchObject({ classification: 'NOT_RECOVERABLE', stale: false });
    }
  );

  it('classifies a running run with a terminal audit as not recoverable', async () => {
    const inconsistent = dependencies();
    inconsistent.runs.inspectForRecovery.mockResolvedValue({
      run: run(),
      terminalAuditPresent: true
    });
    await expect(
      inspectMercadoLibreListingSyncRunRecovery({ runId }, inconsistent)
    ).resolves.toMatchObject({ classification: 'NOT_RECOVERABLE' });
  });

  it('passes only server-derived tenant, actor and threshold to the atomic recovery RPC', async () => {
    const deps = dependencies('Manager');
    deps.runs.inspectForRecovery.mockResolvedValue({
      run: run({
        status: 'succeeded',
        completedAt: '2026-08-27T12:00:00.000Z'
      }),
      terminalAuditPresent: true
    });

    await expect(
      recoverMercadoLibreListingSyncRun(
        { runId, terminalStatus: 'succeeded', reason: 'FINALIZE_INTERRUPTED' },
        deps
      )
    ).resolves.toMatchObject({
      outcome: 'recovered',
      run: { status: 'succeeded', classification: 'NOT_RECOVERABLE' }
    });
    expect(deps.runs.recoverStale).toHaveBeenCalledWith({
      organizationId: 'org_a',
      runId,
      recoveryActorMembershipId: membershipId,
      terminalStatus: 'succeeded',
      reason: 'FINALIZE_INTERRUPTED',
      staleBefore: '2026-08-27T11:45:00.000Z'
    });
  });

  it('rejects extra client fields and invalid reasons before any persistence call', async () => {
    const deps = dependencies();
    await expect(
      recoverMercadoLibreListingSyncRun(
        {
          runId,
          terminalStatus: 'failed',
          reason: 'MANUAL_ABORT',
          organizationId: 'org_attacker'
        } as never,
        deps
      )
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(
      recoverMercadoLibreListingSyncRun(
        { runId, terminalStatus: 'failed', reason: 'FREE_FORM_REASON' } as never,
        deps
      )
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(deps.runs.recoverStale).not.toHaveBeenCalled();
  });
});
