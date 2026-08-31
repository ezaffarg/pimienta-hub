import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { MercadoLibreEventRetryBatchService } from './retry-service';

const eventId = '10000000-0000-4000-8000-000000000001';

describe('MercadoLibreEventRetryBatchService', () => {
  it('uses the due selector and reuses the X-D processor', async () => {
    const events = { listDueRetries: vi.fn().mockResolvedValue([eventId]) };
    const processor = {
      process: vi.fn().mockResolvedValue({
        outcome: 'APPLY',
        processingAttempts: 2,
        safeErrorCode: null
      })
    };
    const service = new MercadoLibreEventRetryBatchService({
      events,
      processor: processor as never
    });

    await expect(service.processDue(10)).resolves.toEqual({
      selected: 1,
      results: [{ outcome: 'APPLY', processingAttempts: 2, safeErrorCode: null }]
    });
    expect(events.listDueRetries).toHaveBeenCalledWith(10);
    expect(processor.process).toHaveBeenCalledWith(eventId);
  });

  it('does nothing when no retry is due', async () => {
    const processor = { process: vi.fn() };
    const service = new MercadoLibreEventRetryBatchService({
      events: { listDueRetries: vi.fn().mockResolvedValue([]) },
      processor: processor as never
    });

    await expect(service.processDue()).resolves.toEqual({ selected: 0, results: [] });
    expect(processor.process).not.toHaveBeenCalled();
  });
});
