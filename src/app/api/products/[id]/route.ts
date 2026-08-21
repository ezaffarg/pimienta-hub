// ============================================================
// Route Handler — Single Product (get + update)
// ============================================================
// See src/app/api/products/route.ts for pattern documentation.
// ============================================================

import { fakeProducts } from '@/constants/mock-api';
import { withServerPermission } from '@/lib/auth/server-context';
import { parseJsonBody, productInputSchema, resourceIdSchema } from '@/lib/api-validation';
import { apiErrorResponse } from '@/lib/api-errors';
import { NextRequest, NextResponse } from 'next/server';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  return withServerPermission('products.read', async (context) => {
    const id = resourceIdSchema.safeParse((await params).id);

    if (!id.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const data = await fakeProducts.getProductById(id.data, context.organizationId);

    if (!data.success) {
      return apiErrorResponse('NOT_FOUND', 404);
    }

    return NextResponse.json(data);
  });
}

export async function PUT(request: NextRequest, { params }: Params) {
  return withServerPermission('products.write', async (context) => {
    const id = resourceIdSchema.safeParse((await params).id);

    if (!id.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const scopedResource = await fakeProducts.getProductById(id.data, context.organizationId);

    if (!scopedResource.success) {
      return apiErrorResponse('NOT_FOUND', 404);
    }

    const body = productInputSchema.safeParse(await parseJsonBody(request));

    if (!body.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const data = await fakeProducts.updateProduct(id.data, body.data, context.organizationId);

    if (!data.success) {
      return apiErrorResponse('NOT_FOUND', 404);
    }

    return NextResponse.json(data);
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return withServerPermission('products.write', async (context) => {
    const id = resourceIdSchema.safeParse((await params).id);

    if (!id.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const data = await fakeProducts.deleteProduct(id.data, context.organizationId);

    if (!data.success) {
      return apiErrorResponse('NOT_FOUND', 404);
    }

    return NextResponse.json(data);
  });
}
