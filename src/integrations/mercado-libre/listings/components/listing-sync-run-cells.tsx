'use client';

import { Badge } from '@/components/ui/badge';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import type {
  ListingSyncRunAdminReadModel,
  ListingSyncRunRecoveryClassification
} from '../recovery-service';

const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC'
});

export function ListingSyncRunStatusBadge({
  status
}: {
  status: ListingSyncRunAdminReadModel['status'];
}) {
  const variant =
    status === 'failed'
      ? 'destructive'
      : status === 'succeeded'
        ? 'default'
        : status === 'partial'
          ? 'secondary'
          : 'outline';
  return <Badge variant={variant}>{status}</Badge>;
}

export function ListingSyncRunStaleBadge({ run }: { run: ListingSyncRunAdminReadModel }) {
  if (run.status !== 'running') return <span className='text-muted-foreground'>—</span>;
  return (
    <Badge variant={run.stale ? 'destructive' : 'outline'}>{run.stale ? 'STALE' : 'ACTIVE'}</Badge>
  );
}

const eligibilityLabels: Record<ListingSyncRunRecoveryClassification, string> = {
  RECOVERABLE_AS_SUCCEEDED: 'Eligible: recover as succeeded',
  RECOVERABLE_AS_FAILED: 'Eligible: mark failed',
  NOT_RECOVERABLE: 'Not recoverable',
  NOT_STALE: 'Not stale'
};

export function ListingSyncRunEligibilityBadge({
  classification
}: {
  classification: ListingSyncRunRecoveryClassification;
}) {
  return (
    <Badge
      variant={classification.startsWith('RECOVERABLE_') ? 'secondary' : 'outline'}
      title={classification}
    >
      {eligibilityLabels[classification]}
    </Badge>
  );
}

export function ListingSyncRunTimestamp({ value }: { value: string | null }) {
  if (!value) return <span className='text-muted-foreground'>—</span>;
  return <time dateTime={value}>{timestampFormatter.format(new Date(value))} UTC</time>;
}

export function ListingSyncRunProgress({ run }: { run: ListingSyncRunAdminReadModel }) {
  const requested = run.progress.requested;
  const persisted = run.progress.persisted;
  const percentage = requested > 0 ? Math.min(100, (persisted / requested) * 100) : null;
  return (
    <div className='flex min-w-40 flex-col gap-1.5 tabular-nums'>
      {percentage === null ? (
        <span className='font-medium'>Persisted {persisted}</span>
      ) : (
        <Progress value={percentage} aria-label={`${persisted} of ${requested} persisted`}>
          <ProgressLabel>
            Persisted {persisted} / {requested}
          </ProgressLabel>
        </Progress>
      )}
      <span className='text-muted-foreground text-xs'>
        Discovered {run.progress.discovered} · Fetched {run.progress.fetched} · Failed{' '}
        {run.progress.failed} · Pages {run.progress.pages} · Batches {run.progress.batches}
      </span>
    </div>
  );
}

export function ListingSyncRunSafeError({ run }: { run: ListingSyncRunAdminReadModel }) {
  if (!run.errorCode) return <span className='text-muted-foreground'>—</span>;
  return (
    <div className='flex max-w-64 flex-col gap-1 whitespace-normal'>
      <code className='text-xs'>{run.errorCode}</code>
      {run.errorSummary ? (
        <span className='text-muted-foreground break-words text-xs'>{run.errorSummary}</span>
      ) : null}
    </div>
  );
}
