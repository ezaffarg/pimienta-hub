import { DEFAULT_LOCALE, type Locale, isLocale } from './config';

type LocaleResolutionInput = {
  explicitLocale?: unknown;
  cookieLocale?: unknown;
  acceptLanguage?: string | null;
};

function mapLanguageTag(value: string): Locale | undefined {
  const primaryLanguage = value.trim().split('-')[0]?.toLowerCase();

  if (primaryLanguage === 'es') return 'es-419';
  if (primaryLanguage === 'pt') return 'pt-BR';
  if (primaryLanguage === 'en') return 'en';

  return undefined;
}

export function resolveAcceptLanguage(value?: string | null): Locale | undefined {
  if (!value) return undefined;

  return value
    .split(',')
    .map((entry, index) => {
      const [rawTag, ...parameters] = entry.trim().split(';');
      let quality = 1;

      for (const parameter of parameters) {
        const match = parameter.trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i);
        if (!match) return null;
        quality = Number(match[1]);
      }

      const locale =
        rawTag && /^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i.test(rawTag)
          ? mapLanguageTag(rawTag)
          : undefined;

      return locale && quality > 0 ? { locale, quality, index } : null;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .toSorted((left, right) => right.quality - left.quality || left.index - right.index)[0]?.locale;
}

export function resolveLocale({
  explicitLocale,
  cookieLocale,
  acceptLanguage
}: LocaleResolutionInput): Locale {
  if (isLocale(explicitLocale)) return explicitLocale;
  if (isLocale(cookieLocale)) return cookieLocale;

  return resolveAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
