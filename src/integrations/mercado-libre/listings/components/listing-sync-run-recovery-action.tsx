'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { Icons } from '@/components/icons';
import { useAppForm } from '@/lib/form';
import { listingSyncRunRecoveryMutation } from '../admin-queries';
import type {
  ListingSyncRunAdminReadModel,
  ListingSyncRunRecoveryClassification
} from '../recovery-service';

export const LISTING_SYNC_RUN_RECOVERY_REASONS = [
  'FINALIZE_INTERRUPTED',
  'PROCESS_CRASHED',
  'MANUAL_ABORT',
  'UNKNOWN_EXECUTION_STATE'
] as const;
const recoveryReasonOptions = LISTING_SYNC_RUN_RECOVERY_REASONS.map((reason) => ({
  value: reason,
  label: reason.replaceAll('_', ' ').toLowerCase()
}));
const recoveryFormSchema = z.object({ reason: z.enum(LISTING_SYNC_RUN_RECOVERY_REASONS) });
export const LISTING_SYNC_RUN_RECOVERY_SAFE_ERROR =
  'Recovery could not be completed. The run was not changed.';

export function ListingSyncRunRecoveryAction({ run }: { run: ListingSyncRunAdminReadModel }) {
  const target = recoveryTargetFor(run.classification);
  if (!target) return <span className='text-muted-foreground'>—</span>;
  return <ListingSyncRunRecoveryDialog run={run} target={target} />;
}

function ListingSyncRunRecoveryDialog({
  run,
  target
}: {
  run: ListingSyncRunAdminReadModel;
  target: 'succeeded' | 'failed';
}) {
  const [open, setOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mutation = useMutation(listingSyncRunRecoveryMutation);
  const form = useAppForm({
    defaultValues: {
      reason: target === 'succeeded' ? 'FINALIZE_INTERRUPTED' : 'UNKNOWN_EXECUTION_STATE'
    } as { reason: (typeof LISTING_SYNC_RUN_RECOVERY_REASONS)[number] },
    validators: { onSubmit: recoveryFormSchema },
    onSubmit: async ({ value }) => {
      if (!target || !canSubmitListingSyncRunRecovery(mutation.isPending)) return;
      setErrorMessage(null);
      try {
        const result = await mutation.mutateAsync({
          runId: run.id,
          terminalStatus: target,
          reason: value.reason
        });
        showRecoveryOutcome(result.outcome, target);
        setOpen(false);
        form.reset();
      } catch {
        setErrorMessage(LISTING_SYNC_RUN_RECOVERY_SAFE_ERROR);
        toast.error(LISTING_SYNC_RUN_RECOVERY_SAFE_ERROR);
      }
    }
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (mutation.isPending) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setErrorMessage(null);
      form.reset();
    }
  };
  const formId = `listing-sync-run-recovery-${run.id}`;
  const targetLabel = target === 'succeeded' ? 'Recover as succeeded' : 'Mark as failed';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant='outline' size='xs' />}>{targetLabel}</DialogTrigger>
      <DialogContent className='sm:max-w-lg' showCloseButton={!mutation.isPending}>
        <DialogHeader>
          <DialogTitle>{targetLabel}</DialogTitle>
          <DialogDescription>
            Confirm the administrative terminal state for this stale listing sync run.
          </DialogDescription>
        </DialogHeader>

        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm'>
          <dt className='text-muted-foreground'>Store</dt>
          <dd className='font-medium'>{run.storeName}</dd>
          <dt className='text-muted-foreground'>Connection</dt>
          <dd>{run.connectionExternalAccountId ?? 'Mercado Libre account unavailable'}</dd>
          <dt className='text-muted-foreground'>Run status</dt>
          <dd>{run.status}</dd>
          <dt className='text-muted-foreground'>Run state</dt>
          <dd>{run.stale ? 'STALE' : 'ACTIVE'}</dd>
          <dt className='text-muted-foreground'>Recovery target</dt>
          <dd>{target}</dd>
        </dl>

        <Alert variant={target === 'failed' ? 'destructive' : 'default'}>
          <Icons.alertCircle aria-hidden='true' />
          <AlertTitle>Administrative recovery only</AlertTitle>
          <AlertDescription>
            {target === 'succeeded'
              ? 'This does not repeat synchronization or call Mercado Libre. It terminalizes a run whose persisted evidence supports success.'
              : 'This marks the run as failed and releases the running gate without deleting counters or checkpoints.'}
          </AlertDescription>
        </Alert>

        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (canSubmitListingSyncRunRecovery(mutation.isPending)) void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.AppField
              name='reason'
              children={(field) => (
                <field.SelectField
                  label='Recovery reason'
                  required
                  options={recoveryReasonOptions}
                  placeholder='Select a reason'
                />
              )}
            />
          </FieldGroup>
        </form>

        {errorMessage ? (
          <p role='alert' className='text-sm text-destructive'>
            {errorMessage}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={mutation.isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <LoadingButton
            type='submit'
            form={formId}
            variant={target === 'failed' ? 'destructive' : 'default'}
            loading={mutation.isPending}
            loadingLabel='Recovering listing sync run…'
          >
            Confirm {target}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function recoveryTargetFor(
  classification: ListingSyncRunRecoveryClassification
): 'succeeded' | 'failed' | null {
  return classification === 'RECOVERABLE_AS_SUCCEEDED'
    ? 'succeeded'
    : classification === 'RECOVERABLE_AS_FAILED'
      ? 'failed'
      : null;
}

export function canSubmitListingSyncRunRecovery(isPending: boolean): boolean {
  return !isPending;
}

export function recoveryOutcomeMessage(
  outcome: 'recovered' | 'already_terminal' | 'not_stale' | 'not_recoverable',
  target: 'succeeded' | 'failed'
): string {
  if (outcome === 'recovered') return `Run recovered as ${target}.`;
  if (outcome === 'already_terminal') return 'This run was already terminalized.';
  return 'This run is no longer eligible for recovery.';
}

export function recoveryOutcomeTone(
  outcome: 'recovered' | 'already_terminal' | 'not_stale' | 'not_recoverable'
): 'success' | 'info' | 'error' {
  return outcome === 'recovered' ? 'success' : outcome === 'already_terminal' ? 'info' : 'error';
}

function showRecoveryOutcome(
  outcome: 'recovered' | 'already_terminal' | 'not_stale' | 'not_recoverable',
  target: 'succeeded' | 'failed'
) {
  const message = recoveryOutcomeMessage(outcome, target);
  const tone = recoveryOutcomeTone(outcome);
  if (tone === 'success') toast.success(message);
  else if (tone === 'info') toast.info(message);
  else toast.error(message);
}
