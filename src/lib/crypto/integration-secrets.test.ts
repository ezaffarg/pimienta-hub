import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  SecretCipherError
} from './integration-secrets';

const key = Buffer.alloc(32, 7);

describe('integration secret encryption', () => {
  it('round-trips AES-GCM ciphertext without preserving plaintext', () => {
    const plaintext = 'access-token-that-must-not-leak';
    const encrypted = encryptIntegrationSecret(plaintext, key);

    expect(encrypted.ciphertext).not.toContain(plaintext);
    expect(decryptIntegrationSecret(encrypted, key)).toBe(plaintext);
  });

  it('fails closed with a different master key', () => {
    const encrypted = encryptIntegrationSecret('refresh-token', key);
    expect(() => decryptIntegrationSecret(encrypted, Buffer.alloc(32, 8))).toThrow(
      SecretCipherError
    );
  });
});
