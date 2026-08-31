import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { IntegrationEventOperationsSummary } from '@/infrastructure/database/integration-event-maintenance-repository';

export function EventOperationsSummary({
  summary
}: {
  summary: IntegrationEventOperationsSummary;
}) {
  const metrics = [
    ['Received backlog', summary.receivedBacklog],
    ['Retries due', summary.retryDue],
    ['Processing', summary.processing],
    ['Processed (24h)', summary.processedRecent],
    ['Failed', summary.failed],
    ['Retry exhausted', summary.retryExhausted]
  ] as const;

  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle>Event operations</CardTitle>
        <CardDescription>
          Tenant-scoped incremental intake and maintenance state. No provider payloads are shown.
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <dl className='grid gap-3 sm:grid-cols-3 xl:grid-cols-6'>
          {metrics.map(([label, value]) => (
            <div key={label} className='flex flex-col gap-1'>
              <dt className='text-muted-foreground text-xs'>{label}</dt>
              <dd className='text-lg font-semibold tabular-nums'>{value}</dd>
            </div>
          ))}
        </dl>
        <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          <span>Last maintenance run:</span>
          {summary.lastRun ? (
            <>
              <Badge variant={summary.lastRun.status === 'failed' ? 'destructive' : 'secondary'}>
                {summary.lastRun.status}
              </Badge>
              <time dateTime={summary.lastRun.startedAt}>
                {formatUtc(summary.lastRun.startedAt)}
              </time>
              <span>
                · received {summary.lastRun.receivedSelected} · retries{' '}
                {summary.lastRun.retrySelected}
                {' · '}processed {summary.lastRun.processed} · failed {summary.lastRun.failed}
                {' · '}missed accepted {summary.lastRun.missedFeedAccepted} · duplicate{' '}
                {summary.lastRun.missedFeedDuplicate}
              </span>
              {summary.lastRun.errorCode ? <span>· error {summary.lastRun.errorCode}</span> : null}
            </>
          ) : (
            <Badge variant='outline'>No local runs yet</Badge>
          )}
        </div>
        <p className='text-xs text-muted-foreground'>
          Last missed-feeds check:{' '}
          {summary.lastRun?.lastMissedFeedCheckAt
            ? formatUtc(summary.lastRun.lastMissedFeedCheckAt)
            : 'Not recorded'}
        </p>
      </CardContent>
    </Card>
  );
}

function formatUtc(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC'
  }).format(new Date(value));
}
