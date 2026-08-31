import 'server-only';

import { z } from 'zod';
import { IntegrationEventProcessingRepository } from '@/infrastructure/database/integration-event-processing-repository';
import { MercadoLibreEventProcessor, type MercadoLibreEventProcessingResult } from './processor';

export interface MercadoLibreRetryBatchResult {
  selected: number;
  results: readonly MercadoLibreEventProcessingResult[];
}

export interface MercadoLibreRetryBatchDependencies {
  events?: Pick<IntegrationEventProcessingRepository, 'listDueRetries'>;
  processor?: Pick<MercadoLibreEventProcessor, 'process'>;
}

export class MercadoLibreEventRetryBatchService {
  constructor(private readonly dependencies: MercadoLibreRetryBatchDependencies = {}) {}

  async processDue(limit = 25): Promise<MercadoLibreRetryBatchResult> {
    const parsedLimit = z.number().int().min(1).max(100).parse(limit);
    const events = this.dependencies.events ?? new IntegrationEventProcessingRepository();
    const processor = this.dependencies.processor ?? new MercadoLibreEventProcessor();
    const eventIds = await events.listDueRetries(parsedLimit);
    const results: MercadoLibreEventProcessingResult[] = [];
    for (const eventId of eventIds) results.push(await processor.process(eventId));
    return { selected: eventIds.length, results };
  }
}
