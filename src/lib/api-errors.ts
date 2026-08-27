import { NextResponse } from 'next/server';

export type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'ORGANIZATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'OAUTH_DENIED'
  | 'INVALID_STATE'
  | 'EXPIRED_STATE'
  | 'CONSUMED_STATE'
  | 'SESSION_MISMATCH'
  | 'CONFIGURATION_ERROR'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'IDENTITY_LOOKUP_FAILED'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'ALREADY_CONNECTED'
  | 'CONNECTION_CONFLICT'
  | 'RECONNECT_TARGET_NOT_FOUND'
  | 'LISTING_SYNC_RUN_RECOVERY_FAILED';

export function apiErrorResponse(code: ApiErrorCode, status: number): NextResponse {
  const messages: Record<ApiErrorCode, string> = {
    AUTHENTICATION_REQUIRED: 'Authentication is required',
    ORGANIZATION_REQUIRED: 'An active organization is required',
    AUTHORIZATION_DENIED: 'The current user is not authorized for this action',
    NOT_FOUND: 'Resource not found',
    VALIDATION_ERROR: 'Request validation failed',
    OAUTH_DENIED: 'OAuth authorization was denied',
    INVALID_STATE: 'OAuth state is invalid',
    EXPIRED_STATE: 'OAuth state has expired',
    CONSUMED_STATE: 'OAuth state has already been used',
    SESSION_MISMATCH: 'OAuth session does not match the request',
    CONFIGURATION_ERROR: 'OAuth configuration is invalid',
    TOKEN_EXCHANGE_FAILED: 'OAuth token exchange failed',
    IDENTITY_LOOKUP_FAILED: 'OAuth identity lookup failed',
    INVALID_PROVIDER_RESPONSE: 'OAuth provider response is invalid',
    ALREADY_CONNECTED: 'This account is already connected',
    CONNECTION_CONFLICT: 'This account cannot be connected here',
    RECONNECT_TARGET_NOT_FOUND: 'The reconnect target was not found',
    LISTING_SYNC_RUN_RECOVERY_FAILED: 'Listing sync run recovery failed safely'
  };

  return NextResponse.json(
    {
      error: {
        code,
        message: messages[code]
      }
    },
    { status }
  );
}
