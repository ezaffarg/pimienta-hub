import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventOperationsSummary } from './event-operations-summary';

describe('EventOperationsSummary', () => {
  it('renders safe aggregate state without provider payloads', () => {
    const html = renderToStaticMarkup(
      createElement(EventOperationsSummary, {
        summary: {
          receivedBacklog: 2,
          retryDue: 1,
          processing: 0,
          processedRecent: 5,
          failed: 1,
          retryExhausted: 0,
          lastRun: {
            id: '10000000-0000-4000-8000-000000000001',
            status: 'partial',
            errorCode: 'event_processing_failed',
            startedAt: '2026-08-28T12:00:00.000Z',
            completedAt: '2026-08-28T12:00:10.000Z',
            lastMissedFeedCheckAt: '2026-08-28T12:00:05.000Z',
            receivedSelected: 2,
            retrySelected: 1,
            processed: 2,
            failed: 1,
            missedFeedAccepted: 1,
            missedFeedDuplicate: 0
          }
        }
      })
    );

    expect(html).toContain('Event operations');
    expect(html).toContain('Received backlog');
    expect(html).toContain('partial');
    expect(html).not.toContain('test-access-token');
    expect(html).not.toContain('raw provider body');
  });
});
