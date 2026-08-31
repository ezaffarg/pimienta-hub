import {
  MercadoLibreEventIntakeError,
  MercadoLibreEventIntakeService
} from '@/integrations/mercado-libre/events';

const MAX_BODY_BYTES = 16 * 1024;
const terminalErrorCodes = new Set([
  'payload_invalid',
  'application_mismatch',
  'connection_not_found',
  'connection_binding_invalid'
]);

export async function POST(request: Request): Promise<Response> {
  let payload;
  try {
    payload = await readBoundedJson(request);
  } catch {
    return callbackResponse(200);
  }

  try {
    await new MercadoLibreEventIntakeService().intakeItemsNotification(payload);
    return callbackResponse(200);
  } catch (error) {
    if (error instanceof MercadoLibreEventIntakeError && terminalErrorCodes.has(error.code)) {
      return callbackResponse(200);
    }
    return callbackResponse(503);
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)
  ) {
    throw new Error('invalid_body');
  }
  if (!request.body) throw new Error('invalid_body');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('invalid_body');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

function callbackResponse(status: 200 | 503): Response {
  return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}
