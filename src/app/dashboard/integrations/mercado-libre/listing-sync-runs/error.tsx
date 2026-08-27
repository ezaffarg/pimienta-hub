'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';

export default function ErrorState({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const retry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <div className='p-4 md:px-6'>
      <Alert variant='destructive'>
        <Icons.alertCircle aria-hidden='true' />
        <AlertTitle>Listing sync runs could not be loaded</AlertTitle>
        <AlertDescription className='flex flex-col items-start gap-3'>
          <span>Try the read-only request again. No synchronization action was executed.</span>
          <Button variant='outline' size='sm' onClick={retry} disabled={isPending}>
            {isPending ? 'Retrying…' : 'Try again'}
          </Button>
          <span role='status' aria-live='polite' className='sr-only'>
            {isPending ? 'Retrying…' : ''}
          </span>
        </AlertDescription>
      </Alert>
    </div>
  );
}
