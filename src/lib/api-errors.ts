import { NextResponse } from 'next/server';

export type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'ORGANIZATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR';

export function apiErrorResponse(code: ApiErrorCode, status: number): NextResponse {
  const messages: Record<ApiErrorCode, string> = {
    AUTHENTICATION_REQUIRED: 'Authentication is required',
    ORGANIZATION_REQUIRED: 'An active organization is required',
    AUTHORIZATION_DENIED: 'The current user is not authorized for this action',
    NOT_FOUND: 'Resource not found',
    VALIDATION_ERROR: 'Request validation failed'
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
