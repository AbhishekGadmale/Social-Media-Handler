import crypto from 'node:crypto';

export interface EncryptedData {
  encrypted: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_VERSION = 1;
const HEX_32_BYTE_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Validates that TOKEN_ENCRYPTION_KEY is present and a valid 32-byte hex string (64 hex characters).
 * Fails fast with clear error messages without leaking secret values.
 *
 * @param env Optional environment object, defaults to process.env
 * @returns 32-byte Buffer representation of the key
 */
export function validateTokenEncryptionKey(
  env: Record<string, string | undefined> = process.env,
): Buffer {
  const rawKey = env.TOKEN_ENCRYPTION_KEY;
  if (!rawKey || !rawKey.trim()) {
    throw new Error('TOKEN_ENCRYPTION_KEY environment variable is missing.');
  }

  const trimmed = rawKey.trim();
  if (!HEX_32_BYTE_REGEX.test(trimmed)) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.');
  }

  return Buffer.from(trimmed, 'hex');
}

function getEncryptionKey(): Buffer {
  return validateTokenEncryptionKey(process.env);
}

export function encrypt(text: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
    keyVersion: KEY_VERSION,
  };
}

export function decrypt(data: EncryptedData): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(data.iv, 'hex');
  const authTag = Buffer.from(data.authTag, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
