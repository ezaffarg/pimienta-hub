import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-errors';
import { parseJsonBody } from '@/lib/api-validation';
import { oauthRouteErrorResponse } from '@/integrations/mercado-libre/auth/route-errors';
import { startMercadoLibreOAuth } from '@/integrations/mercado-libre/auth/runtime';

const connectRequestSchema = z
  .object({ purpose: z.enum(['admin_connect', 'client_self_onboard', 'reconnect']).optional() })
  .strict();

export async function POST(request: NextRequest): Promise<Response> {
  const body = connectRequestSchema.safeParse(await parseJsonBody(request));
  if (!body.success) return apiErrorResponse('VALIDATION_ERROR', 400);

  try {
    const result = await startMercadoLibreOAuth({
      origin: request.headers.get('origin'),
      purpose: body.data.purpose
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return oauthRouteErrorResponse(error);
  }
}
