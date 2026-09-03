import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE_NAME } from './config';
import { loadMessages } from './load-messages';
import { resolveLocale } from './resolve-locale';

type MissingMessage = { key: string; namespace?: string };

export function getSafeMessageFallback(
  { key, namespace }: MissingMessage,
  environment = process.env.NODE_ENV
): string {
  return environment === 'development'
    ? `[missing:${namespace ? `${namespace}.` : ''}${key}]`
    : 'Translation unavailable';
}

export default getRequestConfig(async ({ locale: explicitLocale }) => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale({
    explicitLocale,
    cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get('accept-language')
  });

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: 'UTC',
    onError(error) {
      if (process.env.NODE_ENV === 'development') console.error(error);
    },
    getMessageFallback: getSafeMessageFallback
  };
});
