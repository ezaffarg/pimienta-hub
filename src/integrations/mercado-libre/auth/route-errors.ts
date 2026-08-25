import 'server-only';

import { apiErrorResponse, type ApiErrorCode } from '@/lib/api-errors';
import { AuthenticationRequiredError, OrganizationRequiredError } from '@/lib/auth/server-context';
import { AuthorizationDeniedError } from '@/lib/auth/authorization';
import { OAuthRuntimeError, type OAuthRuntimeErrorCode } from './runtime';

const codes: Record<OAuthRuntimeErrorCode, ApiErrorCode> = {
  oauth_denied: 'OAUTH_DENIED',
  invalid_state: 'INVALID_STATE',
  expired_state: 'EXPIRED_STATE',
  consumed_state: 'CONSUMED_STATE',
  session_mismatch: 'SESSION_MISMATCH',
  configuration_error: 'CONFIGURATION_ERROR',
  token_exchange_failed: 'TOKEN_EXCHANGE_FAILED',
  identity_lookup_failed: 'IDENTITY_LOOKUP_FAILED',
  invalid_provider_response: 'INVALID_PROVIDER_RESPONSE',
  already_connected: 'ALREADY_CONNECTED',
  connection_conflict: 'CONNECTION_CONFLICT',
  reconnect_target_not_found: 'RECONNECT_TARGET_NOT_FOUND'
};

const statuses: Record<OAuthRuntimeErrorCode, number> = {
  oauth_denied: 400,
  invalid_state: 400,
  expired_state: 400,
  consumed_state: 400,
  session_mismatch: 403,
  configuration_error: 500,
  token_exchange_failed: 502,
  identity_lookup_failed: 502,
  invalid_provider_response: 502,
  already_connected: 409,
  connection_conflict: 409,
  reconnect_target_not_found: 404
};

export function oauthRouteErrorResponse(error: unknown): Response {
  if (error instanceof AuthenticationRequiredError) {
    return apiErrorResponse('AUTHENTICATION_REQUIRED', 401);
  }
  if (error instanceof OrganizationRequiredError) {
    return apiErrorResponse('ORGANIZATION_REQUIRED', 403);
  }
  if (error instanceof AuthorizationDeniedError) {
    return apiErrorResponse('AUTHORIZATION_DENIED', 403);
  }
  if (error instanceof OAuthRuntimeError) {
    return apiErrorResponse(codes[error.code], statuses[error.code]);
  }
  return apiErrorResponse('CONFIGURATION_ERROR', 500);
}
