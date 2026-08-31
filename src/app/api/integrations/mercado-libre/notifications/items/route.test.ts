import { beforeEach, describe, expect, it, vi } from 'vitest';

const { intakeMock } = vi.hoisted(() => ({ intakeMock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/integrations/mercado-libre/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/integrations/mercado-libre/events')>();
  return {
    ...actual,
    MercadoLibreEventIntakeService: class {
      intakeItemsNotification = intakeMock;
    }
  };
});

import { MercadoLibreEventIntakeError } from '@/integrations/mercado-libre/events';
import { POST } from './route';

const payload = {
  _id: 'event-1',
  resource: '/items/MLA123456',
  user_id: 123,
  topic: 'items',
  application_id: 456,
  attempts: 1,
  sent: '2026-08-28T12:00:00.000Z',
  received: '2026-08-28T12:00:01.000Z'
};

function request(body: string, headers: HeadersInit = {}): Request {
  return new Request('http://localhost/api/integrations/mercado-libre/notifications/items', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

describe('Mercado Libre items callback', () => {
  beforeEach(() => {
    intakeMock.mockReset();
  });

  it.each(['ACCEPTED', 'DUPLICATE'] as const)(
    'ACKs durable %s intake with an empty 200',
    async (outcome) => {
      intakeMock.mockResolvedValue({ outcome });

      const response = await POST(request(JSON.stringify(payload)));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
      expect(intakeMock).toHaveBeenCalledWith(payload);
    }
  );

  it.each([
    ['invalid topic', 'payload_invalid'],
    ['invalid resource', 'payload_invalid'],
    ['wrong application', 'application_mismatch'],
    ['unknown Connection', 'connection_not_found'],
    ['invalid Connection binding', 'connection_binding_invalid']
  ] as const)('ACKs terminal rejection: %s', async (_condition, code) => {
    intakeMock.mockRejectedValue(new MercadoLibreEventIntakeError(code));

    const response = await POST(request(JSON.stringify(payload)));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it.each([
    ['ambiguous or failed Connection resolution', 'connection_resolution_failed'],
    ['invalid server configuration', 'configuration_invalid'],
    ['temporary intake DB failure', 'intake_failed']
  ] as const)('returns 503 for retryable failure: %s', async (_condition, code) => {
    intakeMock.mockRejectedValue(new MercadoLibreEventIntakeError(code));

    const response = await POST(request(JSON.stringify(payload)));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });

  it('ACKs invalid JSON without invoking intake', async () => {
    const response = await POST(request('{'));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(intakeMock).not.toHaveBeenCalled();
  });

  it.each([
    ['declared', request('{}', { 'content-length': String(16 * 1024 + 1) })],
    ['streamed', request(JSON.stringify({ value: 'x'.repeat(16 * 1024) }))]
  ])('ACKs an oversized %s body without invoking intake', async (_condition, oversized) => {
    const response = await POST(oversized);

    expect(response.status).toBe(200);
    expect(intakeMock).not.toHaveBeenCalled();
  });

  it('does not call a provider or expose payload, IDs, or failures', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    intakeMock.mockRejectedValue(new Error('secret internal connection-id'));

    const response = await POST(request(JSON.stringify(payload)));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
