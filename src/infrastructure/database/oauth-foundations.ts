import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { IntegrationProvider } from '@/integrations/core';
import { createOAuthState } from '@/integrations/mercado-libre/auth';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  type EncryptedSecret
} from '@/lib/crypto/integration-secrets';
import { getSupabaseServerClient } from './supabase-server';
import { PersistenceError } from './repositories';

const providerSchema = z.enum(['mercado-libre', 'shopify', 'tiendanube', 'woocommerce']);
const uuidSchema = z.uuid();
const oauthPurposeSchema = z.enum(['admin_connect', 'client_self_onboard', 'reconnect']);
const auditMetadataSchema = z
  .record(z.string().max(64), z.string().max(256))
  .refine(
    (metadata) =>
      ![
        'access_token',
        'refresh_token',
        'authorization_code',
        'code',
        'password',
        'cookie',
        'authorization'
      ].some((key) => key in metadata),
    'Audit metadata contains a prohibited key'
  );

export type OAuthPurpose = z.infer<typeof oauthPurposeSchema>;
export type OnboardingOutcome = 'created' | 'already_connected' | 'reactivated' | 'conflict';

export interface OAuthAttemptRecord {
  id: string;
  organizationId: string;
  actorMembershipId: string;
  provider: IntegrationProvider;
  purpose: OAuthPurpose;
  encryptedCodeVerifier: string | null;
  keyVersion: number;
  expiresAt: string;
}

export type OAuthAttemptState = 'active' | 'expired' | 'consumed';

export interface DecryptedCredentials {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  tokenMetadata: Record<string, string>;
}

export interface OnboardingResult {
  outcome: OnboardingOutcome;
  storeId: string | null;
  connectionId: string | null;
}

export interface PendingOAuthAuthorization {
  id: string;
  oauthAttemptId: string;
  organizationId: string;
  actorMembershipId: string;
  provider: IntegrationProvider;
  purpose: OAuthPurpose;
  externalAccountId: string;
  displayName: string | null;
  accessTokenExpiresAt: string;
  expiresAt: string;
}

function stateDigest(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

function throwOnError(error: { message: string } | null): void {
  if (error) throw new PersistenceError('OAuth foundation persistence operation failed');
}

function record<T>(data: T | null, error: { message: string } | null): T {
  throwOnError(error);
  if (!data) throw new PersistenceError('OAuth foundation persistence operation returned no data');
  return data;
}

export class OAuthFoundationRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServerClient()) {}

  async createOAuthAttempt(input: {
    organizationId: string;
    actorMembershipId: string;
    provider: IntegrationProvider;
    purpose: OAuthPurpose;
    state: string;
    codeVerifier?: string;
    expiresAt: string;
  }): Promise<OAuthAttemptRecord> {
    const parsed = z
      .object({
        organizationId: z.string().min(1).max(255),
        actorMembershipId: uuidSchema,
        provider: providerSchema,
        purpose: oauthPurposeSchema,
        state: z.string().min(32).max(512),
        codeVerifier: z.string().min(32).max(512).optional(),
        expiresAt: z.iso.datetime()
      })
      .strict()
      .parse(input);
    const verifier = parsed.codeVerifier ? encryptIntegrationSecret(parsed.codeVerifier) : null;
    const { data, error } = await this.client
      .from('oauth_attempts')
      .insert({
        organization_id: parsed.organizationId,
        actor_membership_id: parsed.actorMembershipId,
        provider: parsed.provider,
        purpose: parsed.purpose,
        state_digest: stateDigest(parsed.state),
        encrypted_code_verifier: verifier?.ciphertext ?? null,
        key_version: verifier?.keyVersion ?? 1,
        expires_at: parsed.expiresAt
      })
      .select(
        'id, organization_id, actor_membership_id, provider, purpose, encrypted_code_verifier, key_version, expires_at'
      )
      .single();
    const value = record(data, error);
    return {
      id: value.id,
      organizationId: value.organization_id,
      actorMembershipId: value.actor_membership_id,
      provider: value.provider as IntegrationProvider,
      purpose: value.purpose as OAuthPurpose,
      encryptedCodeVerifier: value.encrypted_code_verifier,
      keyVersion: value.key_version,
      expiresAt: value.expires_at
    };
  }

  async consumeOAuthAttempt(input: {
    organizationId: string;
    actorMembershipId: string;
    state: string;
    now: string;
  }): Promise<OAuthAttemptRecord | null> {
    const parsed = z
      .object({
        organizationId: z.string().min(1).max(255),
        actorMembershipId: uuidSchema,
        state: z.string().min(32).max(512),
        now: z.iso.datetime()
      })
      .strict()
      .parse(input);
    const { data, error } = await this.client
      .from('oauth_attempts')
      .update({ consumed_at: parsed.now })
      .eq('organization_id', parsed.organizationId)
      .eq('actor_membership_id', parsed.actorMembershipId)
      .eq('state_digest', stateDigest(parsed.state))
      .is('consumed_at', null)
      .gt('expires_at', parsed.now)
      .select(
        'id, organization_id, actor_membership_id, provider, purpose, encrypted_code_verifier, key_version, expires_at'
      )
      .maybeSingle();
    throwOnError(error);
    if (!data) return null;
    return {
      id: data.id,
      organizationId: data.organization_id,
      actorMembershipId: data.actor_membership_id,
      provider: data.provider as IntegrationProvider,
      purpose: data.purpose as OAuthPurpose,
      encryptedCodeVerifier: data.encrypted_code_verifier,
      keyVersion: data.key_version,
      expiresAt: data.expires_at
    };
  }

  async getOAuthAttemptState(input: {
    organizationId: string;
    actorMembershipId: string;
    state: string;
    now: string;
  }): Promise<OAuthAttemptState | null> {
    const parsed = z
      .object({
        organizationId: z.string().min(1).max(255),
        actorMembershipId: uuidSchema,
        state: z.string().min(32).max(512),
        now: z.iso.datetime()
      })
      .strict()
      .parse(input);
    const { data, error } = await this.client
      .from('oauth_attempts')
      .select('expires_at, consumed_at')
      .eq('organization_id', parsed.organizationId)
      .eq('actor_membership_id', parsed.actorMembershipId)
      .eq('state_digest', stateDigest(parsed.state))
      .maybeSingle();
    throwOnError(error);
    if (!data) return null;
    if (data.consumed_at) return 'consumed';
    return data.expires_at <= parsed.now ? 'expired' : 'active';
  }

  async storeEncryptedCredentials(input: {
    connectionId: string;
    organizationId: string;
    credentials: DecryptedCredentials;
  }): Promise<void> {
    const parsed = z
      .object({
        connectionId: uuidSchema,
        organizationId: z.string().min(1).max(255),
        credentials: z
          .object({
            accessToken: z.string().min(1).max(8192),
            refreshToken: z.string().min(1).max(8192),
            accessTokenExpiresAt: z.iso.datetime(),
            tokenMetadata: auditMetadataSchema
          })
          .strict()
      })
      .strict()
      .parse(input);
    const access = encryptIntegrationSecret(parsed.credentials.accessToken);
    const refresh = encryptIntegrationSecret(parsed.credentials.refreshToken);
    const { error } = await this.client.from('integration_secrets').upsert(
      {
        connection_id: parsed.connectionId,
        organization_id: parsed.organizationId,
        encrypted_access_token: access.ciphertext,
        encrypted_refresh_token: refresh.ciphertext,
        access_token_expires_at: parsed.credentials.accessTokenExpiresAt,
        token_metadata: parsed.credentials.tokenMetadata,
        key_version: access.keyVersion,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'connection_id' }
    );
    throwOnError(error);
  }

  async readDecryptedCredentials(
    organizationId: string,
    connectionId: string
  ): Promise<DecryptedCredentials | null> {
    const { data, error } = await this.client
      .from('integration_secrets')
      .select(
        'encrypted_access_token, encrypted_refresh_token, access_token_expires_at, token_metadata, key_version'
      )
      .eq('organization_id', z.string().min(1).max(255).parse(organizationId))
      .eq('connection_id', uuidSchema.parse(connectionId))
      .maybeSingle();
    throwOnError(error);
    if (!data) return null;
    const encrypted = (ciphertext: string): EncryptedSecret => ({
      ciphertext,
      keyVersion: data.key_version
    });
    return {
      accessToken: decryptIntegrationSecret(encrypted(data.encrypted_access_token)),
      refreshToken: decryptIntegrationSecret(encrypted(data.encrypted_refresh_token)),
      accessTokenExpiresAt: data.access_token_expires_at,
      tokenMetadata: data.token_metadata as Record<string, string>
    };
  }

  decryptCodeVerifier(attempt: OAuthAttemptRecord): string | null {
    if (!attempt.encryptedCodeVerifier) return null;
    return decryptIntegrationSecret({
      ciphertext: attempt.encryptedCodeVerifier,
      keyVersion: attempt.keyVersion
    });
  }

  async createPendingOAuthAuthorization(input: {
    oauthAttemptId: string;
    organizationId: string;
    actorMembershipId: string;
    provider: IntegrationProvider;
    purpose: OAuthPurpose;
    externalAccountId: string;
    displayName?: string;
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt: string;
    expiresAt: string;
  }): Promise<PendingOAuthAuthorization> {
    const parsed = z
      .object({
        oauthAttemptId: uuidSchema,
        organizationId: z.string().min(1).max(255),
        actorMembershipId: uuidSchema,
        provider: providerSchema,
        purpose: oauthPurposeSchema,
        externalAccountId: z.string().trim().min(1).max(255),
        displayName: z.string().trim().min(1).max(255).optional(),
        accessToken: z.string().min(1).max(8192),
        refreshToken: z.string().min(1).max(8192).optional(),
        accessTokenExpiresAt: z.iso.datetime(),
        expiresAt: z.iso.datetime()
      })
      .strict()
      .parse(input);
    const access = encryptIntegrationSecret(parsed.accessToken);
    const refresh = parsed.refreshToken ? encryptIntegrationSecret(parsed.refreshToken) : null;
    const { data, error } = await this.client
      .from('oauth_pending_authorizations')
      .insert({
        oauth_attempt_id: parsed.oauthAttemptId,
        organization_id: parsed.organizationId,
        actor_membership_id: parsed.actorMembershipId,
        provider: parsed.provider,
        purpose: parsed.purpose,
        external_account_id: parsed.externalAccountId,
        display_name: parsed.displayName ?? null,
        encrypted_access_token: access.ciphertext,
        encrypted_refresh_token: refresh?.ciphertext ?? null,
        access_token_expires_at: parsed.accessTokenExpiresAt,
        key_version: access.keyVersion,
        expires_at: parsed.expiresAt
      })
      .select(
        'id, oauth_attempt_id, organization_id, actor_membership_id, provider, purpose, external_account_id, display_name, access_token_expires_at, expires_at'
      )
      .single();
    return pendingAuthorizationRecord(record(data, error));
  }

  async getPendingOAuthAuthorizationForActor(input: {
    id: string;
    organizationId: string;
    actorMembershipId: string;
    provider: IntegrationProvider;
    purpose: OAuthPurpose;
    now: string;
  }): Promise<PendingOAuthAuthorization | null> {
    const parsed = z
      .object({
        id: uuidSchema,
        organizationId: z.string().min(1).max(255),
        actorMembershipId: uuidSchema,
        provider: providerSchema,
        purpose: oauthPurposeSchema,
        now: z.iso.datetime()
      })
      .strict()
      .parse(input);
    const { data, error } = await this.client
      .from('oauth_pending_authorizations')
      .select(
        'id, oauth_attempt_id, organization_id, actor_membership_id, provider, purpose, external_account_id, display_name, access_token_expires_at, expires_at'
      )
      .eq('id', parsed.id)
      .eq('organization_id', parsed.organizationId)
      .eq('actor_membership_id', parsed.actorMembershipId)
      .eq('provider', parsed.provider)
      .eq('purpose', parsed.purpose)
      .is('consumed_at', null)
      .gt('expires_at', parsed.now)
      .maybeSingle();
    throwOnError(error);
    return data ? pendingAuthorizationRecord(data) : null;
  }

  async consumePendingOAuthAuthorization(input: {
    id: string;
    organizationId: string;
    actorMembershipId: string;
    provider: IntegrationProvider;
    purpose: OAuthPurpose;
    now: string;
  }): Promise<boolean> {
    const parsed = z
      .object({
        id: uuidSchema,
        organizationId: z.string().min(1).max(255),
        actorMembershipId: uuidSchema,
        provider: providerSchema,
        purpose: oauthPurposeSchema,
        now: z.iso.datetime()
      })
      .strict()
      .parse(input);
    const { data, error } = await this.client
      .from('oauth_pending_authorizations')
      .update({ consumed_at: parsed.now })
      .eq('id', parsed.id)
      .eq('organization_id', parsed.organizationId)
      .eq('actor_membership_id', parsed.actorMembershipId)
      .eq('provider', parsed.provider)
      .eq('purpose', parsed.purpose)
      .is('consumed_at', null)
      .gt('expires_at', parsed.now)
      .select('id')
      .maybeSingle();
    throwOnError(error);
    return data !== null;
  }

  async writeAuditEvent(input: {
    organizationId: string;
    actorMembershipId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    storeId?: string;
    metadata: Record<string, string>;
  }): Promise<void> {
    const parsed = z
      .object({
        organizationId: z.string().min(1).max(255),
        actorMembershipId: uuidSchema,
        action: z
          .string()
          .regex(/^[a-z]+(\.[a-z_]+)+$/)
          .max(100),
        resourceType: z.string().trim().min(1).max(100),
        resourceId: z.string().trim().min(1).max(255).optional(),
        storeId: uuidSchema.optional(),
        metadata: auditMetadataSchema
      })
      .strict()
      .parse(input);
    const { error } = await this.client.from('audit_events').insert({
      organization_id: parsed.organizationId,
      actor_membership_id: parsed.actorMembershipId,
      action: parsed.action,
      resource_type: parsed.resourceType,
      resource_id: parsed.resourceId ?? null,
      store_id: parsed.storeId ?? null,
      metadata: parsed.metadata
    });
    throwOnError(error);
  }

  async createAdminOnboarding(input: {
    organizationId: string;
    actorMembershipId: string;
    storeName: string;
    provider: IntegrationProvider;
    externalAccountId: string;
  }): Promise<OnboardingResult> {
    return this.onboardingRpc('create_admin_integration_onboarding', {
      p_organization_id: z.string().min(1).max(255).parse(input.organizationId),
      p_actor_membership_id: uuidSchema.parse(input.actorMembershipId),
      p_store_name: z.string().trim().min(1).max(160).parse(input.storeName),
      p_provider: providerSchema.parse(input.provider),
      p_external_account_id: z.string().trim().min(1).max(255).parse(input.externalAccountId)
    });
  }

  async finalizeAdminPendingOnboarding(input: {
    organizationId: string;
    actorMembershipId: string;
    pendingAuthorizationId: string;
    storeName: string;
  }): Promise<OnboardingResult> {
    return this.onboardingRpc('finalize_admin_pending_integration_onboarding', {
      p_organization_id: z.string().min(1).max(255).parse(input.organizationId),
      p_actor_membership_id: uuidSchema.parse(input.actorMembershipId),
      p_pending_authorization_id: uuidSchema.parse(input.pendingAuthorizationId),
      p_store_name: z.string().trim().min(1).max(160).parse(input.storeName)
    });
  }

  async createClientOnboarding(input: {
    organizationId: string;
    actorMembershipId: string;
    clientMembershipId: string;
    storeName: string;
    provider: IntegrationProvider;
    externalAccountId: string;
  }): Promise<OnboardingResult> {
    return this.onboardingRpc('create_client_integration_onboarding', {
      p_organization_id: z.string().min(1).max(255).parse(input.organizationId),
      p_actor_membership_id: uuidSchema.parse(input.actorMembershipId),
      p_client_membership_id: uuidSchema.parse(input.clientMembershipId),
      p_store_name: z.string().trim().min(1).max(160).parse(input.storeName),
      p_provider: providerSchema.parse(input.provider),
      p_external_account_id: z.string().trim().min(1).max(255).parse(input.externalAccountId)
    });
  }

  private async onboardingRpc(
    name: string,
    args: Record<string, string>
  ): Promise<OnboardingResult> {
    const { data, error } = await this.client.rpc(name, args);
    const value = record(data?.[0] ?? null, error);
    const outcome = z
      .enum(['created', 'already_connected', 'reactivated', 'conflict'])
      .parse(value.outcome);
    return { outcome, storeId: value.store_id, connectionId: value.connection_id };
  }
}

function pendingAuthorizationRecord(record: {
  id: string;
  oauth_attempt_id: string;
  organization_id: string;
  actor_membership_id: string;
  provider: string;
  purpose: string;
  external_account_id: string;
  display_name: string | null;
  access_token_expires_at: string;
  expires_at: string;
}): PendingOAuthAuthorization {
  return {
    id: record.id,
    oauthAttemptId: record.oauth_attempt_id,
    organizationId: record.organization_id,
    actorMembershipId: record.actor_membership_id,
    provider: record.provider as IntegrationProvider,
    purpose: record.purpose as OAuthPurpose,
    externalAccountId: record.external_account_id,
    displayName: record.display_name,
    accessTokenExpiresAt: record.access_token_expires_at,
    expiresAt: record.expires_at
  };
}

export function newOAuthAttemptState(): string {
  return createOAuthState();
}

export function auditMetadata(input: unknown): Record<string, string> {
  return auditMetadataSchema.parse(input);
}
