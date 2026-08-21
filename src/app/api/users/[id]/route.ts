// ============================================================
// Route Handler — Single User (update + delete)
// ============================================================
// See src/app/api/users/route.ts for pattern documentation.
// ============================================================

import { fakeUsers } from '@/constants/mock-api-users';
import { withServerPermission } from '@/lib/auth/server-context';
import { parseJsonBody, resourceIdSchema, userInputSchema } from '@/lib/api-validation';
import { apiErrorResponse } from '@/lib/api-errors';
import { NextRequest, NextResponse } from 'next/server';

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  return withServerPermission('users.write', async (context) => {
    const id = resourceIdSchema.safeParse((await params).id);

    if (!id.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const scopedResource = await fakeUsers.getUserById(id.data, context.organizationId);

    if (!scopedResource.success) {
      return apiErrorResponse('NOT_FOUND', 404);
    }

    const body = userInputSchema.safeParse(await parseJsonBody(request));

    if (!body.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const data = await fakeUsers.updateUser(id.data, body.data, context.organizationId);

    if (!data.success) {
      return apiErrorResponse('NOT_FOUND', 404);
    }

    return NextResponse.json(data);
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return withServerPermission('users.write', async (context) => {
    const id = resourceIdSchema.safeParse((await params).id);

    if (!id.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const data = await fakeUsers.deleteUser(id.data, context.organizationId);

    if (!data.success) {
      return apiErrorResponse('NOT_FOUND', 404);
    }

    return NextResponse.json(data);
  });
}
