import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocaleCookieOptions, LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME } from './config';

const cookieSet = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet })
}));

import { setLocalePreference } from './actions';

describe('locale preference cookie', () => {
  beforeEach(() => {
    cookieSet.mockReset();
    vi.unstubAllEnvs();
  });

  it.each(['es-419', 'pt-BR', 'en'])('accepts the canonical locale %s', async (locale) => {
    await expect(setLocalePreference(locale)).resolves.toBe(true);
    expect(cookieSet).toHaveBeenCalledWith(
      LOCALE_COOKIE_NAME,
      locale,
      expect.objectContaining({
        path: '/',
        sameSite: 'lax',
        httpOnly: false,
        maxAge: LOCALE_COOKIE_MAX_AGE
      })
    );
  });

  it('rejects unsupported input without writing a cookie', async () => {
    await expect(setLocalePreference('../../fr')).resolves.toBe(false);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('sets secure only in production', () => {
    expect(getLocaleCookieOptions('production').secure).toBe(true);
    expect(getLocaleCookieOptions('development').secure).toBe(false);
    expect(LOCALE_COOKIE_MAX_AGE).toBe(31_536_000);
  });
});
