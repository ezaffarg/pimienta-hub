// ============================================================
// Route Handler — Single User (update + delete)
// ============================================================
// See src/app/api/users/route.ts for pattern documentation.
// ============================================================

import { fakeUsers } from '@/constants/mock-api-users';
import { withServerPermission } from '@/lib/auth/server-context';
import { NextRequest, NextResponse } from 'next/server';

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  return withServerPermission('users.write', async (context) => {
    const { id } = await params;
    const { organizationId: _ignoredOrganizationId, ...body } = await request.json();
    const data = await fakeUsers.updateUser(Number(id), body, context.organizationId);

    if (!data.success) {
      return NextResponse.json(data, { status: 404 });
    }

    return NextResponse.json(data);
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return withServerPermission('users.write', async (context) => {
    const { id } = await params;
    const data = await fakeUsers.deleteUser(Number(id), context.organizationId);

    if (!data.success) {
      return NextResponse.json(data, { status: 404 });
    }

    return NextResponse.json(data);
  });
}
