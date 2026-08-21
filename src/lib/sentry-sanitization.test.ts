import { describe, expect, it } from 'vitest';
import { sanitizeSentryPayload } from './sentry-sanitization';

describe('Sentry privacy sanitization', () => {
  it('redacts sensitive request data and credentials without changing safe metadata', () => {
    const event = sanitizeSentryPayload({
      request: {
        headers: { Authorization: 'Bearer SECRET', Cookie: 'session=SECRET' },
        data: { password: 'SECRET' },
        url: 'https://hub.example.test/api/products?access_token=SECRET&page=1'
      },
      extra: {
        access_token: 'SECRET',
        refresh_token: 'SECRET',
        client_secret: 'SECRET',
        safeValue: 'keep'
      }
    });

    expect(event).toEqual({
      request: {
        headers: '[Filtered]',
        data: '[Filtered]',
        url: 'https://hub.example.test/api/products?access_token=%5BFiltered%5D&page=1'
      },
      extra: {
        access_token: '[Filtered]',
        refresh_token: '[Filtered]',
        client_secret: '[Filtered]',
        safeValue: 'keep'
      }
    });
  });

  it('redacts sensitive keys case-insensitively in nested breadcrumb data', () => {
    const breadcrumb = sanitizeSentryPayload({
      data: {
        Authorization: 'Bearer SECRET',
        nested: { Api_Key: 'SECRET', email: 'person@example.test' }
      },
      category: 'navigation'
    });

    expect(breadcrumb).toEqual({
      data: '[Filtered]',
      category: 'navigation'
    });
  });
});
