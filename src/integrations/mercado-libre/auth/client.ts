import 'server-only';

import { z } from 'zod';
import { getMercadoLibreOAuthConfig, type MercadoLibreOAuthConfig } from './config';

const tokenSchema = z
  .object({
    access_token: z.string().min(1).max(8192),
    refresh_token: z.string().min(1).max(8192).optional(),
    expires_in: z.number().finite().positive(),
    token_type: z.string().min(1).max(100),
    scope: z.string().max(1000).optional(),
    user_id: z.union([z.string(), z.number()]).optional()
  })
  .passthrough();

const currentUserSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    nickname: z.string().trim().min(1).max(255).optional()
  })
  .passthrough();

export class MercadoLibreProviderError extends Error {
  constructor(
    public readonly kind:
      | 'token_exchange_failed'
      | 'invalid_provider_response'
      | 'identity_lookup_failed'
  ) {
    super(kind);
    this.name = 'MercadoLibreProviderError';
  }
}

export interface MercadoLibreTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  tokenType: string;
  scope?: string;
  userId?: string;
}

export interface MercadoLibreCurrentUser {
  externalAccountId: string;
  displayName?: string;
}

export class MercadoLibreOAuthClient {
  constructor(
    private readonly config: MercadoLibreOAuthConfig = getMercadoLibreOAuthConfig(),
    private readonly fetcher: typeof fetch = fetch
  ) {}

  buildAuthorizationUrl(input: { state: string; codeChallenge?: string }): string {
    const url = new URL(this.config.authorizationUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', input.state);

    if (this.config.pkceEnabled) {
      if (!input.codeChallenge) throw new Error('PKCE code challenge is required');
      url.searchParams.set('code_challenge', input.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    return url.toString();
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier?: string;
  }): Promise<MercadoLibreTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: input.code,
      redirect_uri: this.config.redirectUri
    });

    if (this.config.pkceEnabled) {
      if (!input.codeVerifier) throw new Error('PKCE code verifier is required');
      body.set('code_verifier', input.codeVerifier);
    }

    let response: Response;
    try {
      response = await this.fetcher(this.config.tokenUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body,
        cache: 'no-store'
      });
    } catch {
      throw new MercadoLibreProviderError('token_exchange_failed');
    }

    if (!response.ok) throw new MercadoLibreProviderError('token_exchange_failed');

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MercadoLibreProviderError('invalid_provider_response');
    }

    const parsed = tokenSchema.safeParse(payload);
    if (!parsed.success) throw new MercadoLibreProviderError('invalid_provider_response');

    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresInSeconds: parsed.data.expires_in,
      tokenType: parsed.data.token_type,
      scope: parsed.data.scope,
      userId: parsed.data.user_id === undefined ? undefined : String(parsed.data.user_id)
    };
  }

  async getCurrentUser(accessToken: string): Promise<MercadoLibreCurrentUser> {
    let response: Response;
    try {
      response = await this.fetcher(this.config.userUrl, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        cache: 'no-store'
      });
    } catch {
      throw new MercadoLibreProviderError('identity_lookup_failed');
    }

    if (!response.ok) throw new MercadoLibreProviderError('identity_lookup_failed');

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MercadoLibreProviderError('invalid_provider_response');
    }

    const parsed = currentUserSchema.safeParse(payload);
    if (!parsed.success) throw new MercadoLibreProviderError('invalid_provider_response');

    return {
      externalAccountId: String(parsed.data.id),
      displayName: parsed.data.nickname
    };
  }
}
