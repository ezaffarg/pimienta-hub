import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { clerkMock, maintenanceMock } = vi.hoisted(() => ({
  clerkMock: vi.fn(),
  maintenanceMock: vi.fn()
}));

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ auth: clerkMock }));
vi.mock('@/integrations/mercado-libre/events', () => ({
  runIncrementalEventMaintenance: maintenanceMock
}));

import { POST } from './route';

const secret = 'scheduler-secret-with-at-least-32-chars';
const success = {
  status: 'succeeded',
  connectionsSelected: 0,
  connectionsStarted: 0,
  connectionsSkipped: 0,
  counters: {},
  safeErrors: []
};

function request(authorization?: string, body?: string): Request {
  return new Request('http://internal/api/internal/maintenance/incremental-events', {
    method: 'POST',
    headers: authorization ? { authorization } : undefined,
    body
  });
}

describe('incremental event maintenance route', () => {
  beforeEach(() => {
    clerkMock.mockReset();
    maintenanceMock.mockReset();
    vi.stubEnv('INTERNAL_SCHEDULER_SECRET', secret);
    maintenanceMock.mockResolvedValue(success);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['missing', undefined],
    ['malformed', secret],
    ['wrong', `Bearer ${'x'.repeat(secret.length)}`]
  ])('denies %s machine authorization', async (_condition, authorization) => {
    const response = await POST(request(authorization));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'unauthorized' });
    expect(maintenanceMock).not.toHaveBeenCalled();
  });

  it('invokes the existing orchestration exactly once without Clerk', async () => {
    const response = await POST(request(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(maintenanceMock).toHaveBeenCalledTimes(1);
    expect(maintenanceMock).toHaveBeenCalledWith();
    expect(clerkMock).not.toHaveBeenCalled();
  });

  it('rejects caller-controlled scope instead of parsing it', async () => {
    const response = await POST(
      request(`Bearer ${secret}`, JSON.stringify({ organizationId: 'org_untrusted' }))
    );

    expect(response.status).toBe(400);
    expect(maintenanceMock).not.toHaveBeenCalled();
  });

  it.each(['partial', 'failed'] as const)('sanitizes controlled %s outcomes', async (status) => {
    maintenanceMock.mockResolvedValue({ ...success, status });

    const response = await POST(request(`Bearer ${secret}`));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'error' });
  });

  it('sanitizes thrown failures without exposing the secret', async () => {
    maintenanceMock.mockRejectedValue(new Error(`provider failed with ${secret}`));

    const response = await POST(request(`Bearer ${secret}`));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toBe('{"status":"error"}');
    expect(text).not.toContain(secret);
  });
});
