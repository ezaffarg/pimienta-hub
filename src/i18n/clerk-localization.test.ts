import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import Providers from '@/components/layout/providers';
import { resolveLocale } from './resolve-locale';
import { CLERK_LOCALE_BY_HUB_LOCALE, loadClerkLocalization } from './clerk-localization';

describe('Clerk localization', () => {
  it('maps every Hub locale to an available official Clerk resource', async () => {
    expect(CLERK_LOCALE_BY_HUB_LOCALE).toEqual({
      'es-419': 'es-MX',
      'pt-BR': 'pt-BR',
      en: 'en-US'
    });

    await expect(loadClerkLocalization('es-419')).resolves.toMatchObject({ locale: 'es-MX' });
    await expect(loadClerkLocalization('pt-BR')).resolves.toMatchObject({ locale: 'pt-BR' });
    await expect(loadClerkLocalization('en')).resolves.toMatchObject({ locale: 'en-US' });
  });

  it('maps the canonical fallback rather than an invalid cookie value', async () => {
    const locale = resolveLocale({ cookieLocale: '../../fr' });
    expect(locale).toBe('es-419');
    await expect(loadClerkLocalization(locale)).resolves.toMatchObject({ locale: 'es-MX' });
  });

  it('passes the resolved localization to ClerkProvider', async () => {
    const localization = await loadClerkLocalization('en');
    const tree = Providers({
      activeThemeValue: 'default',
      clerkLocalization: localization,
      children: null
    }) as ReactElement<{ children: ReactElement<{ children: ReactElement }> }>;
    const activeThemeProvider = tree.props.children;
    const clerkProvider = activeThemeProvider.props.children;

    expect(clerkProvider.props).toMatchObject({ localization });
  });
});
