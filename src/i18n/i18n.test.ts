import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, createTranslator, useTranslations } from 'next-intl';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  resolveHtmlLang
} from './config';
import { loadMessages, mergeMessages } from './load-messages';
import { resolveAcceptLanguage, resolveLocale } from './resolve-locale';

function ClientTranslationProof() {
  const translate = useTranslations('shell');
  return createElement('span', null, translate('language'));
}

describe('i18n locale resolution', () => {
  it('defines the canonical allowlist, default, fallback and cookie name', () => {
    expect(SUPPORTED_LOCALES).toEqual(['es-419', 'pt-BR', 'en']);
    expect(DEFAULT_LOCALE).toBe('es-419');
    expect(FALLBACK_LOCALE).toBe('en');
    expect(LOCALE_COOKIE_NAME).toBe('pimienta_locale');
  });

  it.each([
    ['es', 'es-419'],
    ['es-AR', 'es-419'],
    ['pt', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['en', 'en'],
    ['en-US', 'en']
  ] as const)('maps the %s language family to %s', (header, expected) => {
    expect(resolveAcceptLanguage(header)).toBe(expected);
  });

  it('honors quality ordering and stable header order', () => {
    expect(resolveAcceptLanguage('es;q=0.5, pt-BR;q=0.9, en;q=0.7')).toBe('pt-BR');
    expect(resolveAcceptLanguage('en;q=0.8, pt;q=0.8')).toBe('en');
  });

  it.each(['', 'fr-FR', '@@@', 'es;q=invalid', '*'])(
    'defaults malformed or unsupported %j',
    (header) => {
      expect(resolveLocale({ acceptLanguage: header })).toBe('es-419');
    }
  );

  it('applies explicit, cookie, header and default precedence', () => {
    expect(resolveLocale({ explicitLocale: 'es-419' })).toBe('es-419');
    expect(
      resolveLocale({
        explicitLocale: 'en',
        cookieLocale: 'pt-BR',
        acceptLanguage: 'es'
      })
    ).toBe('en');
    expect(resolveLocale({ cookieLocale: 'pt-BR', acceptLanguage: 'en' })).toBe('pt-BR');
    expect(resolveLocale({ cookieLocale: 'pt-br', acceptLanguage: 'en' })).toBe('en');
    expect(resolveLocale({ explicitLocale: 'fr', cookieLocale: 'en' })).toBe('en');
    expect(resolveLocale({})).toBe('es-419');
  });

  it('excludes q=0 languages', () => {
    expect(resolveLocale({ acceptLanguage: 'pt;q=0, en;q=0.5' })).toBe('en');
  });

  it('returns only a canonical deterministic html lang', () => {
    expect(resolveHtmlLang('pt-BR')).toBe('pt-BR');
    expect(resolveHtmlLang('pt-br')).toBe('es-419');
    expect(resolveHtmlLang('../../en')).toBe('es-419');
    expect(resolveHtmlLang(undefined)).toBe('es-419');
  });
});

describe('i18n messages', () => {
  it('deep-merges nested fallback messages without mutating either input', () => {
    const fallback = { shell: { language: 'Language', loading: 'Loading' } };
    const selected = { shell: { language: 'Idioma' }, extra: { label: 'Extra' } };

    expect(mergeMessages(fallback, selected)).toEqual({
      shell: { language: 'Idioma', loading: 'Loading' },
      extra: { label: 'Extra' }
    });
    expect(fallback).toEqual({ shell: { language: 'Language', loading: 'Loading' } });
    expect(selected).toEqual({ shell: { language: 'Idioma' }, extra: { label: 'Extra' } });
  });

  it.each(['es-419', 'pt-BR'] as const)(
    'falls back from a partial %s nested catalog to English',
    (locale) => {
      const overrides = {
        'es-419': { shell: { language: 'Idioma' } },
        'pt-BR': { shell: { language: 'Idioma' } }
      };
      const messages = mergeMessages(
        { shell: { language: 'Language', loading: 'Loading' } },
        overrides[locale]
      );

      expect(messages).toEqual({ shell: { language: 'Idioma', loading: 'Loading' } });
    }
  );

  it('keeps the English foundation key available', async () => {
    expect((await loadMessages('en')).common.actions.save).toBe('Save');
  });

  it('keeps structural parity across all real catalogs', async () => {
    const catalogs = await Promise.all(SUPPORTED_LOCALES.map(loadMessages));
    const shapes = catalogs.map((catalog) => JSON.stringify(Object.keys(catalog).toSorted()));

    expect(new Set(shapes).size).toBe(1);
    for (const catalog of catalogs) {
      expect(Object.keys(catalog.common.actions).toSorted()).toEqual(['cancel', 'close', 'save']);
      expect(Object.keys(catalog.navigation).toSorted()).toEqual([
        'dashboard',
        'products',
        'users'
      ]);
      expect(Object.keys(catalog.shell).toSorted()).toEqual(['error', 'language', 'loading']);
    }
  });

  it('falls back to a safe allowlisted catalog for unsupported runtime input', async () => {
    const messages = await loadMessages('../../secrets');
    expect(messages.shell.language).toBe('Idioma');
  });

  it('translates on the server with the official translator', async () => {
    const messages = await loadMessages('es-419');
    const translate = createTranslator({ locale: 'es-419', messages, namespace: 'navigation' });

    expect(translate('products')).toBe('Productos');
  });

  it('translates in a client component with a scoped provider', async () => {
    const messages = await loadMessages('pt-BR');
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'pt-BR',
        messages: { shell: messages.shell },
        children: createElement(ClientTranslationProof)
      })
    );

    expect(html).toContain('Idioma');
  });
});
