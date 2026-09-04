import type { ClerkProvider } from '@clerk/nextjs';
import type { ComponentProps } from 'react';
import type { Locale } from './config';

export type ClerkLocalization = NonNullable<ComponentProps<typeof ClerkProvider>['localization']>;

export const CLERK_LOCALE_BY_HUB_LOCALE = {
  'es-419': 'es-MX',
  'pt-BR': 'pt-BR',
  en: 'en-US'
} as const satisfies Record<Locale, string>;

const loaders: Record<Locale, () => Promise<ClerkLocalization>> = {
  'es-419': () => import('@clerk/localizations/es-MX').then(({ esMX }) => esMX),
  'pt-BR': () => import('@clerk/localizations/pt-BR').then(({ ptBR }) => ptBR),
  en: () => import('@clerk/localizations/en-US').then(({ enUS }) => enUS)
};

export function loadClerkLocalization(locale: Locale): Promise<ClerkLocalization> {
  return loaders[locale]();
}
