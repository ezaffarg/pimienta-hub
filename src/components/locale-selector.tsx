'use client';

import { Icons } from '@/components/icons';
import { setLocalePreference } from '@/i18n/actions';
import type { Locale } from '@/i18n/config';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';

export const LOCALE_OPTIONS: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: 'es-419', label: 'Español (Latinoamérica)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en', label: 'English' }
];

export async function persistLocaleSelection(
  value: string,
  writeLocale: (locale: string) => Promise<boolean>,
  refresh: () => void
): Promise<boolean> {
  try {
    if (!(await writeLocale(value))) return false;
    refresh();
    return true;
  } catch {
    return false;
  }
}

export function LocaleSelector() {
  const locale = useLocale();
  const translate = useTranslations('shell');
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [failed, setFailed] = React.useState(false);

  return (
    <div className='px-1.5 py-1'>
      <label htmlFor='locale-selector' className='flex items-center gap-1.5 text-sm'>
        <Icons.language aria-hidden className='size-4 shrink-0' />
        <span>{translate('languageSelector')}</span>
      </label>
      <select
        id='locale-selector'
        aria-label={translate('languageSelector')}
        className='mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
        value={locale}
        disabled={isPending}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setFailed(false);
          startTransition(async () => {
            const saved = await persistLocaleSelection(value, setLocalePreference, router.refresh);
            setFailed(!saved);
          });
        }}
      >
        {LOCALE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p aria-live='polite' className='min-h-4 text-xs text-destructive'>
        {failed ? translate('languageChangeError') : null}
      </p>
    </div>
  );
}
