import 'server-only';

import { z } from 'zod';
import {
  ConnectionRepository,
  HubMembershipRepository
} from '@/infrastructure/database/repositories';
import {
  OAuthFoundationRepository,
  type OAuthAttemptState,
  type OAuthPurpose
} from '@/infrastructure/database/oauth-foundations';
import {
  AuthorizationDeniedError,
  hasPermission,
  type ApprovedRole
} from '@/lib/auth/authorization';
import { requireServerAuthorizationContext } from '@/lib/auth/server-context';
import {
  createCodeChallenge,
  createCodeVerifier,
  createOAuthState,
  getMercadoLibreOAuthConfig,
  MercadoLibreOAuthClient,
  MercadoLibreProviderError,
  type MercadoLibreOAuthConfig
} from '.';

const purposeSchema = z.enum(['admin_connect', 'client_self_onboard', 'reconnect']);
const callbackSchema = z
  .object({
    code: z.string().trim().min(1).max(4096).optional(),
    state: z.string().trim().min(32).max(512).optional(),
    error: z.string().trim().min(1).max(255).optional()
  })
  .strict();

export type OAuthRuntimeErrorCode =
  | 'oauth_denied'
  | 'invalid_state'
  | 'expired_state'
  | 'consumed_state'
  | 'session_mismatch'
  | 'configuration_error'
  | 'token_exchange_failed'
  | 'identity_lookup_failed'
  | 'invalid_provider_response'
  | 'already_connected'
  | 'connection_conflict'
  | 'reconnect_target_not_found';

export class OAuthRuntimeError extends Error {
  constructor(public readonly code: OAuthRuntimeErrorCode) {
    super(code);
    this.name = 'OAuthRuntimeError';
  }
}

interface PersistentOAuthContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: ApprovedRole;
}

interface OAuthRuntimeDependencies {
  now?: () => Date;
  config?: () => MercadoLibreOAuthConfig;
  client?: MercadoLibreOAuthClient;
  foundations?: Pick<
    OAuthFoundationRepository,
    | 'createOAuthAttempt'
    | 'getOAuthAttemptState'
    | 'consumeOAuthAttempt'
    | 'decryptCodeVerifier'
    | 'createPendingOAuthAuthorization'
  >;
  memberships?: Pick<HubMembershipRepository, 'findByOrganizationAndClerkUser'>;
  connections?: Pick<ConnectionRepository, 'findByProviderAndExternalAccount'>;
  context?: () => Promise<{
    userId: string;
    organizationId: string;
    role: ApprovedRole;
    roleSource: 'persistent' | 'clerk-fallback';
  }>;
}

function toIso(date: Date): string {
  return date.toISOString();
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function resolvePurpose(role: ApprovedRole, purpose?: OAuthPurpose): OAuthPurpose {
  if (role === 'Client') {
    if (purpose && purpose !== 'client_self_onboard') throw new AuthorizationDeniedError();
    return 'client_self_onboard';
  }

  if (!hasPermission(role, 'integration:connect')) throw new AuthorizationDeniedError();
  if (purpose === 'client_self_onboard') throw new AuthorizationDeniedError();
  return purpose ?? 'admin_connect';
}

function assertTrustedOrigin(origin: string | null, redirectUri: string): void {
  if (!origin || origin !== new URL(redirectUri).origin) {
    throw new AuthorizationDeniedError();
  }
}

async function requirePersistentContext(
  dependencies: OAuthRuntimeDependencies,
  callbackSession = false
): Promise<PersistentOAuthContext> {
  const context = await (dependencies.context ?? requireServerAuthorizationContext)();
  if (context.roleSource !== 'persistent') {
    if (callbackSession) throw new OAuthRuntimeError('session_mismatch');
    throw new AuthorizationDeniedError();
  }

  const memberships = dependencies.memberships ?? new HubMembershipRepository();
  const membership = await memberships.findByOrganizationAndClerkUser(
    context.organizationId,
    context.userId
  );

  if (!membership || membership.role !== context.role) {
    if (callbackSession) throw new OAuthRuntimeError('session_mismatch');
    throw new AuthorizationDeniedError();
  }
  return { ...context, membershipId: membership.id };
}

function mapProviderError(error: unknown): OAuthRuntimeError {
  if (error instanceof MercadoLibreProviderError) {
    if (error.kind === 'provider_response_invalid') {
      return new OAuthRuntimeError('invalid_provider_response');
    }
    if (error.kind === 'identity_lookup_failed') {
      return new OAuthRuntimeError('identity_lookup_failed');
    }
    return new OAuthRuntimeError('token_exchange_failed');
  }
  return new OAuthRuntimeError('configuration_error');
}

export async function startMercadoLibreOAuth(
  input: { origin: string | null; purpose?: unknown },
  dependencies: OAuthRuntimeDependencies = {}
): Promise<{ authorizationUrl: string }> {
  let config: MercadoLibreOAuthConfig;
  try {
    config = (dependencies.config ?? getMercadoLibreOAuthConfig)();
  } catch {
    throw new OAuthRuntimeError('configuration_error');
  }

  assertTrustedOrigin(input.origin, config.redirectUri);
  const context = await requirePersistentContext(dependencies);
  const purpose = purposeSchema.optional().safeParse(input.purpose);
  if (!purpose.success) throw new AuthorizationDeniedError();
  const resolvedPurpose = resolvePurpose(context.role, purpose.data);
  const state = createOAuthState();
  const verifier = config.pkceEnabled ? createCodeVerifier() : undefined;
  const now = (dependencies.now ?? (() => new Date()))();
  const foundations = dependencies.foundations ?? new OAuthFoundationRepository();

  await foundations.createOAuthAttempt({
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    provider: 'mercado-libre',
    purpose: resolvedPurpose,
    state,
    codeVerifier: verifier,
    expiresAt: toIso(addMinutes(now, 10))
  });

  const client = dependencies.client ?? new MercadoLibreOAuthClient(config);
  return {
    authorizationUrl: client.buildAuthorizationUrl({
      state,
      codeChallenge: verifier ? createCodeChallenge(verifier) : undefined
    })
  };
}

function stateError(state: OAuthAttemptState | null): OAuthRuntimeError {
  if (state === 'expired') return new OAuthRuntimeError('expired_state');
  if (state === 'consumed') return new OAuthRuntimeError('consumed_state');
  return new OAuthRuntimeError('invalid_state');
}

export async function completeMercadoLibreOAuth(
  input: { code?: string | null; state?: string | null; error?: string | null },
  dependencies: OAuthRuntimeDependencies = {}
): Promise<{ status: 'READY_FOR_ONBOARDING' | 'READY_FOR_RECONNECT'; displayName?: string }> {
  const callback = callbackSchema.safeParse({
    code: input.code ?? undefined,
    state: input.state ?? undefined,
    error: input.error ?? undefined
  });
  if (!callback.success || !callback.data.state) throw new OAuthRuntimeError('invalid_state');

  const context = await requirePersistentContext(dependencies, true);
  const now = (dependencies.now ?? (() => new Date()))();
  const nowIso = toIso(now);
  const foundations = dependencies.foundations ?? new OAuthFoundationRepository();
  const attemptState = await foundations.getOAuthAttemptState({
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    state: callback.data.state,
    now: nowIso
  });
  if (attemptState !== 'active') throw stateError(attemptState);

  const attempt = await foundations.consumeOAuthAttempt({
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    state: callback.data.state,
    now: nowIso
  });
  if (!attempt) throw new OAuthRuntimeError('consumed_state');
  if (attempt.provider !== 'mercado-libre') throw new OAuthRuntimeError('invalid_state');
  if (callback.data.error) throw new OAuthRuntimeError('oauth_denied');
  if (!callback.data.code) throw new OAuthRuntimeError('invalid_state');

  let config: MercadoLibreOAuthConfig;
  try {
    config = (dependencies.config ?? getMercadoLibreOAuthConfig)();
  } catch {
    throw new OAuthRuntimeError('configuration_error');
  }

  const client = dependencies.client ?? new MercadoLibreOAuthClient(config);
  let token;
  let currentUser;
  try {
    token = await client.exchangeAuthorizationCode({
      code: callback.data.code,
      codeVerifier: foundations.decryptCodeVerifier(attempt) ?? undefined
    });
    currentUser = await client.getCurrentUser(token.accessToken);
  } catch (error) {
    throw mapProviderError(error);
  }

  const connections = dependencies.connections ?? new ConnectionRepository();
  const existing = await connections.findByProviderAndExternalAccount(
    'mercado-libre',
    currentUser.externalAccountId
  );
  if (existing && existing.provider !== 'mercado-libre') {
    throw new OAuthRuntimeError('connection_conflict');
  }
  if (existing && existing.externalAccountId !== currentUser.externalAccountId) {
    throw new OAuthRuntimeError('connection_conflict');
  }
  if (existing && existing.organizationId !== context.organizationId) {
    throw new OAuthRuntimeError('connection_conflict');
  }
  if (attempt.purpose === 'reconnect' && !existing) {
    throw new OAuthRuntimeError('reconnect_target_not_found');
  }
  if (attempt.purpose !== 'reconnect' && existing) {
    throw new OAuthRuntimeError('already_connected');
  }

  await foundations.createPendingOAuthAuthorization({
    oauthAttemptId: attempt.id,
    organizationId: context.organizationId,
    actorMembershipId: context.membershipId,
    provider: 'mercado-libre',
    purpose: attempt.purpose,
    targetConnectionId: existing?.id ?? null,
    externalAccountId: currentUser.externalAccountId,
    displayName: currentUser.displayName,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    accessTokenExpiresAt: toIso(new Date(now.getTime() + token.expiresInSeconds * 1000)),
    expiresAt: toIso(addMinutes(now, 20))
  });

  return attempt.purpose === 'reconnect'
    ? { status: 'READY_FOR_RECONNECT', displayName: currentUser.displayName }
    : { status: 'READY_FOR_ONBOARDING', displayName: currentUser.displayName };
}
