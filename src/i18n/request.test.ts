import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

const requestState = vi.hoisted(() => ({
  cookieLocale: undefined as string | undefined,
  acceptLanguage: null as string | null
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'pimienta_locale' && requestState.cookieLocale
        ? { value: requestState.cookieLocale }
        : undefined
  }),
  headers: async () => ({
    get: (name: string) => (name === 'accept-language' ? requestState.acceptLanguage : null)
  })
}));

vi.mock('next-intl/server', () => ({
  getRequestConfig: <T>(createRequestConfig: T) => createRequestConfig
}));

import requestConfig, { getSafeMessageFallback } from './request';

describe('next-intl request configuration', () => {
  it('uses the canonical default and explicit UTC without request preferences', async () => {
    requestState.cookieLocale = undefined;
    requestState.acceptLanguage = null;

    const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });

    expect(config.locale).toBe('es-419');
    expect(config.timeZone).toBe('UTC');
  });

  it('resolves request locale and messages through the official config boundary', async () => {
    requestState.cookieLocale = 'pt-BR';
    requestState.acceptLanguage = 'en';

    const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });
    const translate = createTranslator({
      locale: config.locale,
      messages: config.messages!,
      namespace: 'navigation'
    });

    expect(config.locale).toBe('pt-BR');
    expect(translate('products')).toBe('Produtos');
  });

  it('lets a valid explicit locale override cookie and header inputs', async () => {
    requestState.cookieLocale = 'pt-BR';
    requestState.acceptLanguage = 'es';

    const config = await requestConfig({
      locale: 'en',
      requestLocale: Promise.resolve(undefined)
    });

    expect(config.locale).toBe('en');
  });

  it('makes missing keys visible in development and safe in production', () => {
    const missing = { namespace: 'shell', key: 'unknown' };

    expect(getSafeMessageFallback(missing, 'development')).toBe('[missing:shell.unknown]');
    expect(getSafeMessageFallback(missing, 'production')).toBe('Translation unavailable');
  });
});
