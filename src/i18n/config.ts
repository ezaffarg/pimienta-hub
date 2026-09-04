export const SUPPORTED_LOCALES = ['es-419', 'pt-BR', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type NavigationKey = keyof typeof import('./messages/en/navigation.json');

export const DEFAULT_LOCALE: Locale = 'es-419';
export const FALLBACK_LOCALE: Locale = 'en';
export const LOCALE_COOKIE_NAME = 'pimienta_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as Locale);
}

export function resolveHtmlLang(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
