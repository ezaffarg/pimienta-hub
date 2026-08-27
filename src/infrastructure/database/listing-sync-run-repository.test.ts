import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import { ListingSyncRunRepository, ListingSyncRunStartError } from './listing-sync-run-repository';

const scope = {
  organizationId: 'org_a',
  storeId: '11111111-1111-4111-8111-111111111111',
  connectionId: '22222222-2222-4222-8222-222222222222'
};
const actorMembershipId = '33333333-3333-4333-8333-333333333333';
const idempotencyKey = '44444444-4444-4444-8444-444444444444';
const runId = '55555555-5555-4555-8555-555555555555';
const progress = {
  discovered: 4,
  requested: 4,
  fetched: 3,
  persisted: 3,
  failed: 1,
  pages: 1,
  batches: 1
};

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: runId,
    organization_id: scope.organizationId,
    store_id: scope.storeId,
    connection_id: scope.connectionId,
    actor_membership_id: actorMembershipId,
    kind: 'listing_backfill',
    idempotency_key: idempotencyKey,
    status: 'running',
    started_at: '2026-08-25T22:00:00.000Z',
    completed_at: null,
    last_checkpoint_at: '2026-08-25T22:00:00.000Z',
    discovered_count: 0,
    requested_count: 0,
    fetched_count: 0,
    persisted_count: 0,
    failed_count: 0,
    pages_count: 0,
    batches_count: 0,
    error_code: null,
    error_summary: null,
    updated_at: '2026-08-25T22:00:00.000Z',
    ...overrides
  };
}

describe('ListingSyncRunRepository', () => {
  it.each(['started', 'reused', 'already_running'] as const)(
    'maps the controlled start outcome %s and scopes all RPC inputs',
    async (outcome) => {
      const rpc = vi.fn().mockResolvedValue({
        data: [{ outcome, ...runRow() }],
        error: null
      });
      const repository = new ListingSyncRunRepository({
        rpc
      } as unknown as SupabaseClient);

      await expect(
        repository.start({ scope, actorMembershipId, idempotencyKey })
      ).resolves.toMatchObject({
        outcome,
        run: {
          id: runId,
          organizationId: scope.organizationId,
          status: 'running'
        }
      });
      expect(rpc).toHaveBeenCalledWith('start_listing_sync_run', {
        p_organization_id: scope.organizationId,
        p_store_id: scope.storeId,
        p_connection_id: scope.connectionId,
        p_actor_membership_id: actorMembershipId,
        p_idempotency_key: idempotencyKey
      });
    }
  );

  it('distinguishes an RPC transport/schema failure without exposing its message', async () => {
    const repository = new ListingSyncRunRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'raw schema cache detail' }
      })
    } as unknown as SupabaseClient);

    const error = await repository
      .start({ scope, actorMembershipId, idempotencyKey })
      .catch((cause: unknown) => cause);

    expect(error).toEqual(
      new ListingSyncRunStartError('RUN_START_RPC_FAILED', {
        stage: 'rpc_response',
        thrown: false,
        rpcReturnedData: false,
        rpcErrorPresent: true,
        rpcErrorCode: 'PGRST202',
        outcome: null,
        transportClass: null
      })
    );
    expect(error).not.toMatchObject({ message: expect.stringContaining('schema cache') });
  });

  it('rejects extra properties inside the strict listing scope before calling RPC', async () => {
    const rpc = vi.fn();
    const repository = new ListingSyncRunRepository({ rpc } as unknown as SupabaseClient);

    await expect(
      repository.start({
        scope: { ...scope, unexpected: 'metadata' },
        actorMembershipId,
        idempotencyKey
      } as never)
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['actor missing', 'actor belongs to another tenant'])(
    'classifies a safe server rejection: %s',
    async (rawMessage) => {
      const repository = new ListingSyncRunRepository({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'P0001', message: rawMessage }
        })
      } as unknown as SupabaseClient);

      const error = await repository
        .start({ scope, actorMembershipId, idempotencyKey })
        .catch((cause: unknown) => cause);

      expect(error).toMatchObject({
        code: 'RUN_START_REJECTED',
        diagnostic: { stage: 'rpc_response', thrown: false, rpcErrorCode: 'P0001' }
      });
      expect(error).not.toMatchObject({ message: rawMessage });
    }
  );

  it.each([null, [], [{}, {}]])('rejects a malformed RPC response safely', async (data) => {
    const repository = new ListingSyncRunRepository({
      rpc: vi.fn().mockResolvedValue({ data, error: null })
    } as unknown as SupabaseClient);

    await expect(
      repository.start({ scope, actorMembershipId, idempotencyKey })
    ).rejects.toMatchObject({
      code: 'RUN_START_RESPONSE_INVALID',
      diagnostic: { stage: 'response', rpcErrorPresent: false }
    });
  });

  it('distinguishes mapping failure after a structurally valid RPC response', async () => {
    const repository = new ListingSyncRunRepository({
      rpc: vi.fn().mockResolvedValue({
        data: [{ outcome: 'started', ...runRow({ status: 'unexpected' }) }],
        error: null
      })
    } as unknown as SupabaseClient);

    await expect(repository.start({ scope, actorMembershipId, idempotencyKey })).rejects.toEqual(
      new ListingSyncRunStartError('RUN_START_MAPPING_FAILED', {
        stage: 'mapping',
        thrown: false,
        rpcReturnedData: true,
        rpcErrorPresent: false,
        rpcErrorCode: null,
        outcome: 'started',
        transportClass: null
      })
    );
  });

  it('classifies a thrown fetch failure without leaking raw request material', async () => {
    const raw =
      'fetch failed Authorization: Bearer token https://example.invalid?apikey=secret-material';
    const repository = new ListingSyncRunRepository({
      rpc: vi.fn().mockRejectedValue(new TypeError(raw))
    } as unknown as SupabaseClient);

    const error = await repository
      .start({ scope, actorMembershipId, idempotencyKey })
      .catch((cause: unknown) => cause);

    expect(error).toEqual(
      new ListingSyncRunStartError('RUN_START_RPC_FAILED', {
        stage: 'rpc_call',
        thrown: true,
        rpcReturnedData: false,
        rpcErrorPresent: false,
        rpcErrorCode: null,
        outcome: null,
        transportClass: 'fetch'
      })
    );
    expect(JSON.stringify(error)).not.toContain('Authorization');
    expect(JSON.stringify(error)).not.toContain('secret-material');
    expect(error).not.toMatchObject({ message: expect.stringContaining('example.invalid') });
  });

  it('writes a tenant-bound monotonic checkpoint through the canonical RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        runRow({
          discovered_count: 4,
          requested_count: 4,
          fetched_count: 3,
          persisted_count: 3,
          failed_count: 1,
          pages_count: 1,
          batches_count: 1
        })
      ],
      error: null
    });
    const repository = new ListingSyncRunRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(repository.checkpoint({ scope, runId, progress })).resolves.toMatchObject(
      progress
    );
    expect(rpc).toHaveBeenCalledWith(
      'checkpoint_listing_sync_run',
      expect.objectContaining({
        p_organization_id: scope.organizationId,
        p_run_id: runId,
        p_failed_count: 1,
        p_pages_count: 1,
        p_batches_count: 1
      })
    );
  });

  it('finalizes with an allowlisted safe error and rejects secret-bearing summaries', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        runRow({
          status: 'partial',
          completed_at: '2026-08-25T22:01:00.000Z',
          error_code: 'partial_item_failure',
          error_summary: 'One or more listing items could not be synchronized',
          ...Object.fromEntries(
            Object.entries(progress).map(([key, value]) => [
              `${key === 'pages' || key === 'batches' ? key : key}_count`,
              value
            ])
          )
        })
      ],
      error: null
    });
    const repository = new ListingSyncRunRepository({
      rpc
    } as unknown as SupabaseClient);

    await expect(
      repository.finalize({
        scope,
        runId,
        status: 'partial',
        progress,
        errorCode: 'partial_item_failure',
        errorSummary: 'One or more listing items could not be synchronized'
      })
    ).resolves.toMatchObject({
      status: 'partial',
      errorCode: 'partial_item_failure'
    });
    await expect(
      repository.finalize({
        scope,
        runId,
        status: 'failed',
        progress,
        errorCode: 'credential_failure',
        errorSummary: 'access_token=must-not-persist'
      })
    ).rejects.toThrow('prohibited material');
  });

  it.each([
    [
      'checkpoint',
      (repository: ListingSyncRunRepository) => repository.checkpoint({ scope, runId, progress })
    ],
    [
      'finalize',
      (repository: ListingSyncRunRepository) =>
        repository.finalize({ scope, runId, status: 'succeeded', progress })
    ]
  ] as const)('sanitizes %s RPC failures', async (_operation, execute) => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'authorization bearer-token raw database detail' }
    });
    const repository = new ListingSyncRunRepository({
      rpc
    } as unknown as SupabaseClient);
    const error = await execute(repository).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ message: 'Listing sync run persistence operation failed' });
    expect(error).not.toMatchObject({ message: expect.stringContaining('bearer-token') });
  });

  it.each([
    [
      'checkpoint',
      (repository: ListingSyncRunRepository) => repository.checkpoint({ scope, runId, progress }),
      'Listing sync run checkpoint RPC failed'
    ],
    [
      'finalize',
      (repository: ListingSyncRunRepository) =>
        repository.finalize({ scope, runId, status: 'succeeded', progress }),
      'Listing sync run finalize RPC failed'
    ]
  ] as const)('sanitizes a thrown %s RPC failure', async (_operation, execute, safeMessage) => {
    const repository = new ListingSyncRunRepository({
      rpc: vi
        .fn()
        .mockRejectedValue(
          new Error('Authorization bearer token https://example.invalid?apikey=secret-material')
        )
    } as unknown as SupabaseClient);

    const error = await execute(repository).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ message: safeMessage });
    expect(JSON.stringify(error)).not.toContain('Authorization');
    expect(JSON.stringify(error)).not.toContain('secret-material');
  });

  it('gets a run only through its full Organization, Store, and Connection scope', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: runRow(), error: null });
    const connectionFilter = vi.fn(() => ({ maybeSingle }));
    const storeFilter = vi.fn(() => ({ eq: connectionFilter }));
    const organizationFilter = vi.fn(() => ({ eq: storeFilter }));
    const idFilter = vi.fn(() => ({ eq: organizationFilter }));
    const repository = new ListingSyncRunRepository({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: idFilter })) }))
    } as unknown as SupabaseClient);

    await expect(repository.get(scope, runId)).resolves.toMatchObject({
      id: runId
    });
    expect(idFilter).toHaveBeenCalledWith('id', runId);
    expect(organizationFilter).toHaveBeenCalledWith('organization_id', scope.organizationId);
    expect(storeFilter).toHaveBeenCalledWith('store_id', scope.storeId);
    expect(connectionFilter).toHaveBeenCalledWith('connection_id', scope.connectionId);
  });

  it.each(['recovered', 'already_terminal', 'not_stale', 'not_recoverable'] as const)(
    'maps the controlled administrative recovery outcome %s',
    async (outcome) => {
      const rpc = vi.fn().mockResolvedValue({
        data: [{ outcome, ...runRow() }],
        error: null
      });
      const repository = new ListingSyncRunRepository({ rpc } as unknown as SupabaseClient);

      await expect(
        repository.recoverStale({
          organizationId: scope.organizationId,
          runId,
          recoveryActorMembershipId: actorMembershipId,
          terminalStatus: 'failed',
          reason: 'PROCESS_CRASHED',
          staleBefore: '2026-08-25T22:30:00.000Z'
        })
      ).resolves.toMatchObject({ outcome, run: { id: runId } });
      expect(rpc).toHaveBeenCalledWith('recover_stale_listing_sync_run', {
        p_organization_id: scope.organizationId,
        p_run_id: runId,
        p_recovery_actor_membership_id: actorMembershipId,
        p_terminal_status: 'failed',
        p_recovery_reason: 'PROCESS_CRASHED',
        p_stale_before: '2026-08-25T22:30:00.000Z'
      });
    }
  );

  it('inspects recovery state through Organization and terminal audit boundaries', async () => {
    const runMaybeSingle = vi.fn().mockResolvedValue({ data: runRow(), error: null });
    const runQuery = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: runMaybeSingle
    };
    const auditQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ count: 1, error: null })
    };
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => (table === 'listing_sync_runs' ? runQuery : auditQuery))
    }));
    const repository = new ListingSyncRunRepository({ from } as unknown as SupabaseClient);

    await expect(repository.inspectForRecovery(scope.organizationId, runId)).resolves.toMatchObject(
      {
        run: { id: runId, organizationId: scope.organizationId },
        terminalAuditPresent: true
      }
    );
    expect(from).toHaveBeenNthCalledWith(1, 'listing_sync_runs');
    expect(runQuery.eq).toHaveBeenCalledWith('organization_id', scope.organizationId);
    expect(from).toHaveBeenNthCalledWith(2, 'audit_events');
    expect(auditQuery.eq).toHaveBeenCalledWith('organization_id', scope.organizationId);
    expect(auditQuery.eq).toHaveBeenCalledWith('resource_id', runId);
    expect(auditQuery.in).toHaveBeenCalledWith('action', [
      'listing.sync.succeeded',
      'listing.sync.partial',
      'listing.sync.failed'
    ]);
  });

  it('lists recent runs by Organization and resolves terminal audits in one batch', async () => {
    const runQuery = {
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [runRow()], error: null })
    };
    const auditQuery = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn()
    };
    auditQuery.in.mockImplementation((column: string) =>
      column === 'resource_id'
        ? auditQuery
        : Promise.resolve({ data: [{ resource_id: runId }], error: null })
    );
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => (table === 'listing_sync_runs' ? runQuery : auditQuery))
    }));
    const repository = new ListingSyncRunRepository({ from } as unknown as SupabaseClient);

    await expect(repository.listRecentForRecovery(scope.organizationId, 50)).resolves.toEqual([
      expect.objectContaining({
        run: expect.objectContaining({ id: runId }),
        terminalAuditPresent: true
      })
    ]);
    expect(runQuery.eq).toHaveBeenCalledWith('organization_id', scope.organizationId);
    expect(runQuery.order).toHaveBeenCalledWith('started_at', { ascending: false });
    expect(runQuery.limit).toHaveBeenCalledWith(50);
    expect(auditQuery.eq).toHaveBeenCalledWith('organization_id', scope.organizationId);
    expect(auditQuery.in).toHaveBeenCalledWith('resource_id', [runId]);
  });

  it('sanitizes administrative recovery RPC errors and malformed responses', async () => {
    const failure = new ListingSyncRunRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'raw tenant and token detail' }
      })
    } as unknown as SupabaseClient);
    await expect(
      failure.recoverStale({
        organizationId: scope.organizationId,
        runId,
        recoveryActorMembershipId: actorMembershipId,
        terminalStatus: 'failed',
        reason: 'UNKNOWN_EXECUTION_STATE',
        staleBefore: '2026-08-25T22:30:00.000Z'
      })
    ).rejects.toMatchObject({ message: 'Listing sync run recovery failed' });

    const malformed = new ListingSyncRunRepository({
      rpc: vi.fn().mockResolvedValue({ data: [{ outcome: 'unexpected' }], error: null })
    } as unknown as SupabaseClient);
    await expect(
      malformed.recoverStale({
        organizationId: scope.organizationId,
        runId,
        recoveryActorMembershipId: actorMembershipId,
        terminalStatus: 'failed',
        reason: 'UNKNOWN_EXECUTION_STATE',
        staleBefore: '2026-08-25T22:30:00.000Z'
      })
    ).rejects.toMatchObject({ message: 'Listing sync run recovery response invalid' });
  });
});
