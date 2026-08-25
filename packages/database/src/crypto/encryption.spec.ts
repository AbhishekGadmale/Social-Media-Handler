import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt } from './encryption.js';

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
