'use server';

import { cookies } from 'next/headers';
import { getLocaleCookieOptions, isLocale, LOCALE_COOKIE_NAME } from './config';

export async function setLocalePreference(value: string): Promise<boolean> {
  if (!isLocale(value)) return false;

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, value, getLocaleCookieOptions());
  return true;
}
