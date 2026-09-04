import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/load-messages';

vi.mock('@/i18n/actions', () => ({ setLocalePreference: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { LOCALE_OPTIONS, LocaleSelector, persistLocaleSelection } from './locale-selector';

describe('locale selector', () => {
  it('renders the three exact options and reflects the resolved locale', async () => {
    const messages = await loadMessages('pt-BR');
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'pt-BR',
        messages: { shell: messages.shell },
        children: createElement(LocaleSelector)
      })
    );

    expect(LOCALE_OPTIONS).toEqual([
      { value: 'es-419', label: 'Español (Latinoamérica)' },
      { value: 'pt-BR', label: 'Português (Brasil)' },
      { value: 'en', label: 'English' }
    ]);
    expect(html).toContain('Español (Latinoamérica)');
    expect(html).toContain('Português (Brasil)');
    expect(html).toContain('English');
    expect(html).toContain('<option value="pt-BR" selected="">');
  });

  it.each(['es-419', 'pt-BR', 'en'])(
    'persists %s and refreshes without navigation',
    async (locale) => {
      const writeLocale = vi.fn().mockResolvedValue(true);
      const refresh = vi.fn();

      await expect(persistLocaleSelection(locale, writeLocale, refresh)).resolves.toBe(true);
      expect(writeLocale).toHaveBeenCalledWith(locale);
      expect(refresh).toHaveBeenCalledOnce();
    }
  );

  it('does not refresh or pretend success when the write fails', async () => {
    const refresh = vi.fn();

    await expect(
      persistLocaleSelection('pt-BR', vi.fn().mockRejectedValue(new Error('private')), refresh)
    ).resolves.toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
