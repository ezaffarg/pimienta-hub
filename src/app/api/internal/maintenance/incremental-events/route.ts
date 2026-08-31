import { timingSafeEqual } from 'node:crypto';
import { runIncrementalEventMaintenance } from '@/integrations/mercado-libre/events';

const responseHeaders = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow'
};

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get('authorization'))) {
    return response('unauthorized', 401);
  }
  if (request.body !== null) return response('invalid_request', 400);

  try {
    const result = await runIncrementalEventMaintenance();
    return result.status === 'succeeded' ? response('ok', 200) : response('error', 503);
  } catch {
    return response('error', 503);
  }
}

function isAuthorized(header: string | null): boolean {
  const secret = process.env.INTERNAL_SCHEDULER_SECRET;
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;

  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function response(status: 'ok' | 'error' | 'unauthorized' | 'invalid_request', code: number) {
  return Response.json({ status }, { status: code, headers: responseHeaders });
}
