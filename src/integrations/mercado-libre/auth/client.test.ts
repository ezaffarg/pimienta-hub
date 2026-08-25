import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { MercadoLibreOAuthClient, MercadoLibreProviderError } from './client';

const config = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://app.example.test/api/integrations/mercado-libre/callback',
  pkceEnabled: true,
  authorizationUrl: 'https://auth.mercadolibre.com.ar/authorization',
  tokenUrl: 'https://api.mercadolibre.com/oauth/token',
  userUrl: 'https://api.mercadolibre.com/users/me'
};

describe('MercadoLibreOAuthClient', () => {
  it('builds the official authorization URL without application identity fields', () => {
    const client = new MercadoLibreOAuthClient(config, vi.fn());
    const url = new URL(
      client.buildAuthorizationUrl({ state: 'state-value', codeChallenge: 'challenge' })
    );

    expect(url.origin + url.pathname).toBe('https://auth.mercadolibre.com.ar/authorization');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('organizationId')).toBe(false);
    expect(url.searchParams.has('storeId')).toBe(false);
  });

  it('sends the authorization code only in the server-side form body', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600,
          token_type: 'bearer'
        })
      )
    );
    const client = new MercadoLibreOAuthClient(config, fetcher);

    await expect(
      client.exchangeAuthorizationCode({ code: 'test-code', codeVerifier: 'test-verifier' })
    ).resolves.toMatchObject({ expiresInSeconds: 3600 });

    const [, request] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(request.method).toBe('POST');
    expect(request.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' });
    expect(String(request.body)).toContain('code=test-code');
  });

  it('rejects malformed token responses without exposing provider payloads', async () => {
    const client = new MercadoLibreOAuthClient(
      config,
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'missing fields' })))
    );

    await expect(
      client.exchangeAuthorizationCode({ code: 'test-code', codeVerifier: 'test-verifier' })
    ).rejects.toThrow('invalid_provider_response');
  });

  it('refreshes only server-side with a rotated refresh token', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'test-access-token-v2',
          refresh_token: 'test-refresh-token-v2',
          expires_in: 3600,
          token_type: 'bearer'
        })
      )
    );
    const client = new MercadoLibreOAuthClient(config, fetcher);

    await expect(client.refreshAccessToken('test-refresh-token-v1')).resolves.toMatchObject({
      refreshToken: 'test-refresh-token-v2'
    });
    const [, request] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(String(request.body)).toContain('grant_type=refresh_token');
    expect(String(request.body)).toContain('refresh_token=test-refresh-token-v1');
  });

  it('rejects a refresh response that omits the rotated refresh token', async () => {
    const client = new MercadoLibreOAuthClient(
      config,
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              access_token: 'test-access-token',
              expires_in: 3600,
              token_type: 'bearer'
            })
          )
        )
    );

    await expect(client.refreshAccessToken('test-refresh-token')).rejects.toEqual(
      expect.objectContaining({ kind: 'invalid_provider_response' })
    );
  });

  it('normalizes the current user identity and rejects malformed provider responses', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 123, nickname: '  ML Test  ' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ nickname: 'missing id' })));
    const client = new MercadoLibreOAuthClient(config, fetcher);

    await expect(client.getCurrentUser('test-access-token')).resolves.toEqual({
      externalAccountId: '123',
      displayName: 'ML Test'
    });
    await expect(client.getCurrentUser('test-access-token')).rejects.toThrow(
      MercadoLibreProviderError
    );
  });
});
