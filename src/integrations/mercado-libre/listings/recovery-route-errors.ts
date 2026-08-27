import { z } from 'zod';
import { apiErrorResponse } from '@/lib/api-errors';
import { AuthorizationDeniedError } from '@/lib/auth/authorization';
import {
  AuthenticationRequiredError,
  OrganizationRequiredError
} from '@/lib/auth/server-context';
import { ListingSyncRunRecoveryError } from './recovery-service';

export function listingSyncRunRecoveryRouteErrorResponse(error: unknown): Response {
  if (error instanceof AuthenticationRequiredError) {
    return apiErrorResponse('AUTHENTICATION_REQUIRED', 401);
  }
  if (error instanceof OrganizationRequiredError) {
    return apiErrorResponse('ORGANIZATION_REQUIRED', 403);
  }
  if (error instanceof AuthorizationDeniedError) {
    return apiErrorResponse('AUTHORIZATION_DENIED', 403);
  }
  if (error instanceof ListingSyncRunRecoveryError && error.code === 'not_found') {
    return apiErrorResponse('NOT_FOUND', 404);
  }
  if (error instanceof z.ZodError) return apiErrorResponse('VALIDATION_ERROR', 400);
  return apiErrorResponse('LISTING_SYNC_RUN_RECOVERY_FAILED', 500);
}
