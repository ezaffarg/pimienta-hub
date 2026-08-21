// ============================================================
// Route Handler — Users (list + create)
// ============================================================
// Used with Pattern 2 (Route Handlers + ORM) or Pattern 3 (BFF).
//
// Fullstack (ORM): Replace fakeUsers calls with your ORM
//   const users = await db.query.users.findMany({ ... })
//
// BFF (proxy): Replace with fetch to your external backend
//   const res = await fetch(`${BACKEND_URL}/users?${searchParams}`, {
//     headers: { Authorization: `Bearer ${token}` }
//   })
//   return NextResponse.json(await res.json())
//
// Current: Mock (in-memory fake data for demo/prototyping)
// ============================================================

import { fakeUsers } from '@/constants/mock-api-users';
import { withServerPermission } from '@/lib/auth/server-context';
import { parseJsonBody, userInputSchema, userListQuerySchema } from '@/lib/api-validation';
import { apiErrorResponse } from '@/lib/api-errors';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return withServerPermission('users.read', async (context) => {
    const query = userListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));

    if (!query.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const data = await fakeUsers.getUsers({
      organizationId: context.organizationId,
      ...query.data
    });

    return NextResponse.json(data);
  });
}

export async function POST(request: NextRequest) {
  return withServerPermission('users.write', async (context) => {
    const body = userInputSchema.safeParse(await parseJsonBody(request));

    if (!body.success) {
      return apiErrorResponse('VALIDATION_ERROR', 400);
    }

    const data = await fakeUsers.createUser(body.data, context.organizationId);
    return NextResponse.json(data, { status: 201 });
  });
}
