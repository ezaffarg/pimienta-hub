import 'server-only';

import { z } from 'zod';

const configurationSchema = z
  .object({
    clientId: z.string().trim().min(1).max(255),
    clientSecret: z.string().min(1).max(1024),
    redirectUri: z.url().refine((value) => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.search && !url.hash;
    }, 'MERCADO_LIBRE_REDIRECT_URI must be an exact HTTPS URL without query or hash'),
    pkceEnabled: z.boolean()
  })
  .strict();

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;

  if (value !== 'true' && value !== 'false') {
    throw new Error('MERCADO_LIBRE_PKCE_ENABLED must be true or false');
  }

  return value === 'true';
}

export interface MercadoLibreOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  pkceEnabled: boolean;
  authorizationUrl: string;
  tokenUrl: string;
  userUrl: string;
}

export function getMercadoLibreOAuthConfig(): MercadoLibreOAuthConfig {
  const parsed = configurationSchema.parse({
    clientId: process.env.MERCADO_LIBRE_CLIENT_ID,
    clientSecret: process.env.MERCADO_LIBRE_CLIENT_SECRET,
    redirectUri: process.env.MERCADO_LIBRE_REDIRECT_URI,
    pkceEnabled: parseBoolean(process.env.MERCADO_LIBRE_PKCE_ENABLED)
  });

  return {
    ...parsed,
    authorizationUrl: 'https://auth.mercadolibre.com.ar/authorization',
    tokenUrl: 'https://api.mercadolibre.com/oauth/token',
    userUrl: 'https://api.mercadolibre.com/users/me'
  };
}
