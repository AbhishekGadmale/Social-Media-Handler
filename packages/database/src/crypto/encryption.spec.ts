import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt, validateTokenEncryptionKey } from './encryption';

describe('Encryption Utility', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // 32-byte hex string
    process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateTokenEncryptionKey', () => {
    const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    it('returns a 32-byte buffer for a valid lowercase hex key', () => {
      const buffer = validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: validKey });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(32);
      expect(buffer.toString('hex')).toBe(validKey);
    });

    it('returns a 32-byte buffer for a valid uppercase hex key', () => {
      const upperKey = validKey.toUpperCase();
      const buffer = validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: upperKey });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(32);
      expect(buffer.toString('hex')).toBe(validKey);
    });

    it('trims leading and trailing whitespace from a valid hex key', () => {
      const buffer = validateTokenEncryptionKey({
        TOKEN_ENCRYPTION_KEY: `  ${validKey}  `,
      });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(32);
      expect(buffer.toString('hex')).toBe(validKey);
    });

    it('reads from process.env by default when no argument is supplied', () => {
      process.env.TOKEN_ENCRYPTION_KEY = validKey;
      const buffer = validateTokenEncryptionKey();
      expect(buffer.length).toBe(32);
      expect(buffer.toString('hex')).toBe(validKey);
    });

    it('throws when key is missing or undefined', () => {
      expect(() => validateTokenEncryptionKey({})).toThrow(
        'TOKEN_ENCRYPTION_KEY environment variable is missing.',
      );
      expect(() => validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: undefined })).toThrow(
        'TOKEN_ENCRYPTION_KEY environment variable is missing.',
      );
    });

    it('throws when key is empty string', () => {
      expect(() => validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: '' })).toThrow(
        'TOKEN_ENCRYPTION_KEY environment variable is missing.',
      );
    });

    it('throws when key is whitespace only', () => {
      expect(() => validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: '   ' })).toThrow(
        'TOKEN_ENCRYPTION_KEY environment variable is missing.',
      );
    });

    it('throws when hex string is too short (e.g. 63 chars or 32 chars)', () => {
      const shortKey = validKey.slice(0, 63);
      expect(() => validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: shortKey })).toThrow(
        'TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.',
      );
      expect(() => validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: '0123' })).toThrow(
        'TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.',
      );
    });

    it('throws when hex string is too long (e.g. 65 chars)', () => {
      const longKey = `${validKey}0`;
      expect(() => validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: longKey })).toThrow(
        'TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.',
      );
    });

    it('throws when key contains non-hex characters', () => {
      const nonHexKey = validKey.slice(0, 63) + 'g';
      expect(() => validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: nonHexKey })).toThrow(
        'TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.',
      );
    });
  });

  it('should encrypt and decrypt a string successfully', () => {
    const plaintext = 'super-secret-token-123';
    const encryptedData = encrypt(plaintext);
    
    expect(encryptedData.encrypted).toBeDefined();
    expect(encryptedData.iv).toBeDefined();
    expect(encryptedData.authTag).toBeDefined();
    expect(encryptedData.keyVersion).toBe(1);

    const decrypted = decrypt(encryptedData);
    expect(decrypted).toBe(plaintext);
  });

  it('should generate different IVs and ciphertexts for the same plaintext', () => {
    const plaintext = 'same-text';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1.iv).not.toBe(encrypted2.iv);
    expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
  });

  it('should throw when decrypting with tampered authTag', () => {
    const plaintext = 'tamper-me';
    const encryptedData = encrypt(plaintext);

    // Tamper with the authTag by changing a character
    const tamperedAuthTag = encryptedData.authTag.replace(/[0-9a-f]/, 'f');
    const modifiedData = {
      ...encryptedData,
      authTag: tamperedAuthTag === encryptedData.authTag ? encryptedData.authTag.replace(/[0-9a-f]/, '0') : tamperedAuthTag,
    };

    expect(() => decrypt(modifiedData)).toThrow();
  });

  it('should throw if TOKEN_ENCRYPTION_KEY is missing', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('TOKEN_ENCRYPTION_KEY environment variable is missing');
  });

  it('should throw if TOKEN_ENCRYPTION_KEY is not 32 bytes', () => {
    process.env.TOKEN_ENCRYPTION_KEY = '0123';
    expect(() => encrypt('test')).toThrow('TOKEN_ENCRYPTION_KEY must be a 32-byte hex string');
  });
});
