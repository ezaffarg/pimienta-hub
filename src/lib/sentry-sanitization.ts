const REDACTED_VALUE = '[Filtered]';

const sensitiveKeyPattern =
  /^(authorization|cookie|set-cookie|password|token|access_token|refresh_token|client_secret|api_key|secret|session|email|username|ip_address)$/i;

const requestDataKeyPattern = /^(headers|cookies|body|data|query|query_string)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value, 'https://sentry.invalid');

    for (const key of url.searchParams.keys()) {
      if (sensitiveKeyPattern.test(key)) {
        url.searchParams.set(key, REDACTED_VALUE);
      }
    }

    return value.startsWith('http') ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return REDACTED_VALUE;
  }
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (sensitiveKeyPattern.test(key) || requestDataKeyPattern.test(key)) {
        return [key, REDACTED_VALUE];
      }

      if (key === 'url' && typeof entry === 'string') {
        return [key, sanitizeUrl(entry)];
      }

      return [key, sanitizeValue(entry)];
    })
  );
}

export function sanitizeSentryPayload<T>(payload: T): T {
  return sanitizeValue(payload) as T;
}
