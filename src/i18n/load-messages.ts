import { DEFAULT_LOCALE, FALLBACK_LOCALE, type Locale, isLocale } from './config';
import englishMessages from './messages/en';

export type MessageTree = { [key: string]: string | MessageTree };
export type Messages = typeof englishMessages;

const loaders: Record<Locale, () => Promise<{ default: MessageTree }>> = {
  'es-419': () => import('./messages/es-419'),
  'pt-BR': () => import('./messages/pt-BR'),
  en: () => Promise.resolve({ default: englishMessages })
};

export function mergeMessages(fallback: MessageTree, selected: MessageTree): MessageTree {
  return Object.fromEntries(
    [...new Set([...Object.keys(fallback), ...Object.keys(selected)])].map((key) => {
      const fallbackValue = fallback[key];
      const selectedValue = selected[key];

      if (selectedValue === undefined) {
        return [
          key,
          typeof fallbackValue === 'string' ? fallbackValue : mergeMessages(fallbackValue ?? {}, {})
        ];
      }

      if (typeof selectedValue === 'string') return [key, selectedValue];

      return [
        key,
        mergeMessages(typeof fallbackValue === 'string' ? {} : (fallbackValue ?? {}), selectedValue)
      ];
    })
  );
}

export async function loadMessages(locale: unknown): Promise<Messages> {
  const safeLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const selectedMessages = (await loaders[safeLocale]()).default;

  return (
    safeLocale === FALLBACK_LOCALE
      ? mergeMessages(englishMessages, {})
      : mergeMessages(englishMessages, selectedMessages)
  ) as Messages;
}
