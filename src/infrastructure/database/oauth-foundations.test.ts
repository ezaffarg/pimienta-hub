import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { auditMetadata, newOAuthAttemptState } from './oauth-foundations';

describe('OAuth foundation validation', () => {
  it('generates opaque state with sufficient entropy representation', () => {
    const state = newOAuthAttemptState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(newOAuthAttemptState()).not.toBe(state);
  });

  it('allows small metadata and rejects secret-like fields', () => {
    expect(auditMetadata({ outcome: 'created' })).toEqual({ outcome: 'created' });
    expect(() => auditMetadata({ access_token: 'secret' })).toThrow();
  });
});
