// ============================================================
// Route Handler — Products (list + create)
// ============================================================
// Used with Pattern 2 (Route Handlers + ORM) or Pattern 3 (BFF).
//
// Fullstack (ORM): Replace fakeProducts calls with your ORM
//   const products = await db.query.products.findMany({ ... })
//
// BFF (proxy): Replace with fetch to your external backend
//   const res = await fetch(`${BACKEND_URL}/products?${searchParams}`, {
//     headers: { Authorization: `Bearer ${token}` }
//   })
//   return NextResponse.json(await res.json())
//
// Current: Mock (in-memory fake data for demo/prototyping)
// ============================================================

import { fakeProducts } from '@/constants/mock-api';
import { withServerPermission } from '@/lib/auth/server-context';
import { parseJsonBody, productInputSchema, productListQuerySchema } from '@/lib/api-validation';
import { apiErrorResponse } from '@/lib/api-errors';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return withServerPermission('products.read', async (context) => {
    const query = productListQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    if (!query.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const data = await fakeProducts.getProducts({
      organizationId: context.organizationId,
      ...query.data
    });

    return NextResponse.json(data);
  });
}

export async function POST(request: NextRequest) {
  return withServerPermission('products.write', async (context) => {
    const body = productInputSchema.safeParse(await parseJsonBody(request));

    if (!body.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const data = await fakeProducts.createProduct(body.data, context.organizationId);
    return NextResponse.json(data, { status: 201 });
  });
}
