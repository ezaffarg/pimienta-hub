import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

export function createOAuthState(): string {
  return base64Url(randomBytes(32));
}

export function createCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

export function createCodeChallenge(codeVerifier: string): string {
  return base64Url(createHash('sha256').update(codeVerifier).digest());
}
