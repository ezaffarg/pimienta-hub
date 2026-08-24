import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const CURRENT_KEY_VERSION = 1;

export class SecretCipherError extends Error {
  constructor() {
    super('Unable to process integration secret');
    this.name = 'SecretCipherError';
  }
}

export interface EncryptedSecret {
  ciphertext: string;
  keyVersion: number;
}

export function getIntegrationSecretsMasterKey(): Buffer {
  const value = process.env.INTEGRATION_SECRETS_MASTER_KEY;
  if (!value) throw new SecretCipherError();

  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new SecretCipherError();
  return key;
}

export function encryptIntegrationSecret(
  plaintext: string,
  key = getIntegrationSecretsMasterKey()
): EncryptedSecret {
  if (!plaintext) throw new SecretCipherError();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.'),
    keyVersion: CURRENT_KEY_VERSION
  };
}

export function decryptIntegrationSecret(
  encrypted: EncryptedSecret,
  key = getIntegrationSecretsMasterKey()
): string {
  try {
    const [ivValue, tagValue, ciphertextValue, extra] = encrypted.ciphertext.split('.');
    if (!ivValue || !tagValue || !ciphertextValue || extra || encrypted.keyVersion < 1) {
      throw new SecretCipherError();
    }
    const iv = Buffer.from(ivValue, 'base64url');
    const tag = Buffer.from(tagValue, 'base64url');
    if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) throw new SecretCipherError();
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new SecretCipherError();
  }
}
