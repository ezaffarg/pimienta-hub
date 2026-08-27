import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-errors';
import {
  listingSyncRunAdminListQuerySchema,
  listMercadoLibreListingSyncRuns
} from '@/integrations/mercado-libre/listings/recovery-service';
import { listingSyncRunRecoveryRouteErrorResponse } from '@/integrations/mercado-libre/listings/recovery-route-errors';

export async function GET(request: NextRequest): Promise<Response> {
  const query = listingSyncRunAdminListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!query.success) return apiErrorResponse('VALIDATION_ERROR', 400);

  try {
    return NextResponse.json(await listMercadoLibreListingSyncRuns(query.data));
  } catch (error) {
    return listingSyncRunRecoveryRouteErrorResponse(error);
  }
}
