// ============================================================
// Route Handler — Single Product (get + update)
// ============================================================
// See src/app/api/products/route.ts for pattern documentation.
// ============================================================

import { fakeProducts } from '@/constants/mock-api';
import { withServerPermission } from '@/lib/auth/server-context';
import { NextRequest, NextResponse } from 'next/server';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  return withServerPermission('products.read', async (context) => {
    const { id } = await params;
    const data = await fakeProducts.getProductById(Number(id), context.organizationId);

    if (!data.success) {
      return NextResponse.json(data, { status: 404 });
    }

    return NextResponse.json(data);
  });
}

export async function PUT(request: NextRequest, { params }: Params) {
  return withServerPermission('products.write', async (context) => {
    const { id } = await params;
    const { organizationId: _ignoredOrganizationId, ...body } = await request.json();
    const data = await fakeProducts.updateProduct(Number(id), body, context.organizationId);

    if (!data.success) {
      return NextResponse.json(data, { status: 404 });
    }

    return NextResponse.json(data);
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return withServerPermission('products.write', async (context) => {
    const { id } = await params;
    const data = await fakeProducts.deleteProduct(Number(id), context.organizationId);

    if (!data.success) {
      return NextResponse.json(data, { status: 404 });
    }

    return NextResponse.json(data);
  });
}
