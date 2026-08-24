import { NextRequest, NextResponse } from 'next/server';
import { oauthRouteErrorResponse } from '@/integrations/mercado-libre/auth/route-errors';
import { completeMercadoLibreOAuth } from '@/integrations/mercado-libre/auth/runtime';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const result = await completeMercadoLibreOAuth({
      code: request.nextUrl.searchParams.get('code'),
      state: request.nextUrl.searchParams.get('state'),
      error: request.nextUrl.searchParams.get('error')
    });
    return NextResponse.json(result);
  } catch (error) {
    return oauthRouteErrorResponse(error);
  }
}
