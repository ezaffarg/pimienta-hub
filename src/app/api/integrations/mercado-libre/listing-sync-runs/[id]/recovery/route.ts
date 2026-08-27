import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-errors';
import { parseJsonBody } from '@/lib/api-validation';
import {
  inspectMercadoLibreListingSyncRunRecovery,
  listingSyncRunRecoveryRequestSchema,
  recoverMercadoLibreListingSyncRun
} from '@/integrations/mercado-libre/listings/recovery-service';
import { listingSyncRunRecoveryRouteErrorResponse } from '@/integrations/mercado-libre/listings/recovery-route-errors';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    return NextResponse.json(await inspectMercadoLibreListingSyncRunRecovery({ runId: id }));
  } catch (error) {
    return listingSyncRunRecoveryRouteErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const body = listingSyncRunRecoveryRequestSchema.safeParse(await parseJsonBody(request));
  if (!body.success) return apiErrorResponse('VALIDATION_ERROR', 400);

  try {
    const { id } = await context.params;
    const result = await recoverMercadoLibreListingSyncRun({ runId: id, ...body.data });
    return NextResponse.json(result);
  } catch (error) {
    return listingSyncRunRecoveryRouteErrorResponse(error);
  }
}
