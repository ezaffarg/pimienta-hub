import 'server-only';

const allowedScopes = new Set(['read', 'write', 'offline_access']);

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function parseScopes(value: string): readonly string[] {
  const scopes = value.split(/\s+/).filter(Boolean);

  if (scopes.length === 0 || scopes.some((scope) => !allowedScopes.has(scope))) {
    throw new Error('MELI_OAUTH_SCOPES contains an unsupported scope');
  }

  return [...new Set(scopes)];
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  if (value !== 'true' && value !== 'false') {
    throw new Error('MELI_PKCE_ENABLED must be true or false');
  }

  return value === 'true';
}

export interface MercadoLibreOAuthConfig {
  appId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: readonly string[];
  pkceEnabled: boolean;
  authorizationUrl: string;
  tokenUrl: string;
}

export function getMercadoLibreOAuthConfig(): MercadoLibreOAuthConfig {
  const redirectUri = required('MELI_REDIRECT_URI');
  const parsedRedirectUri = new URL(redirectUri);

  if (parsedRedirectUri.protocol !== 'https:') {
    throw new Error('MELI_REDIRECT_URI must use HTTPS');
  }

  const pkceEnabled = parseBoolean(process.env.MELI_PKCE_ENABLED);
  const site = parsedRedirectUri.hostname.endsWith('.com.ar') ? 'ar' : 'com';

  return {
    appId: required('MELI_APP_ID'),
    clientSecret: required('MELI_CLIENT_SECRET'),
    redirectUri,
    scopes: parseScopes(required('MELI_OAUTH_SCOPES')),
    pkceEnabled,
    authorizationUrl: `https://auth.mercadolibre.com.${site}/authorization`,
    tokenUrl: 'https://api.mercadolibre.com/oauth/token'
  };
}
