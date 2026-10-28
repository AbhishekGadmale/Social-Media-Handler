import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt, validateTokenEncryptionKey } from "./encryption";

describe("Encryption Utility", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // 32-byte hex string
    process.env.TOKEN_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("validateTokenEncryptionKey", () => {
    const validKey =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    it("returns a 32-byte buffer for a valid lowercase hex key", () => {
      const buffer = validateTokenEncryptionKey({
        TOKEN_ENCRYPTION_KEY: validKey,
      });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(32);
      expect(buffer.toString("hex")).toBe(validKey);
    });

    it("returns a 32-byte buffer for a valid uppercase hex key", () => {
      const upperKey = validKey.toUpperCase();
      const buffer = validateTokenEncryptionKey({
        TOKEN_ENCRYPTION_KEY: upperKey,
      });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(32);
      expect(buffer.toString("hex")).toBe(validKey);
    });

    it("trims leading and trailing whitespace from a valid hex key", () => {
      const buffer = validateTokenEncryptionKey({
        TOKEN_ENCRYPTION_KEY: `  ${validKey}  `,
      });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(32);
      expect(buffer.toString("hex")).toBe(validKey);
    });

    it("reads from process.env by default when no argument is supplied", () => {
      process.env.TOKEN_ENCRYPTION_KEY = validKey;
      const buffer = validateTokenEncryptionKey();
      expect(buffer.length).toBe(32);
      expect(buffer.toString("hex")).toBe(validKey);
    });

    it("throws when key is missing or undefined", () => {
      expect(() => validateTokenEncryptionKey({})).toThrow(
        "TOKEN_ENCRYPTION_KEY environment variable is missing.",
      );
      expect(() =>
        validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: undefined }),
      ).toThrow("TOKEN_ENCRYPTION_KEY environment variable is missing.");
    });

    it("throws when key is empty string", () => {
      expect(() =>
        validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: "" }),
      ).toThrow("TOKEN_ENCRYPTION_KEY environment variable is missing.");
    });

    it("throws when key is whitespace only", () => {
      expect(() =>
        validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: "   " }),
      ).toThrow("TOKEN_ENCRYPTION_KEY environment variable is missing.");
    });

    it("throws when hex string is too short (e.g. 63 chars or 32 chars)", () => {
      const shortKey = validKey.slice(0, 63);
      expect(() =>
        validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: shortKey }),
      ).toThrow("TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.");
      expect(() =>
        validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: "0123" }),
      ).toThrow("TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.");
    });

    it("throws when hex string is too long (e.g. 65 chars)", () => {
      const longKey = `${validKey}0`;
      expect(() =>
        validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: longKey }),
      ).toThrow("TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.");
    });

    it("throws when key contains non-hex characters", () => {
      const nonHexKey = validKey.slice(0, 63) + "g";
      expect(() =>
        validateTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: nonHexKey }),
      ).toThrow("TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.");
    });
  });

  it("should encrypt and decrypt a string successfully", () => {
    const plaintext = "super-secret-token-123";
    const encryptedData = encrypt(plaintext);

    expect(encryptedData.encrypted).toBeDefined();
    expect(encryptedData.iv).toBeDefined();
    expect(encryptedData.authTag).toBeDefined();
    expect(encryptedData.keyVersion).toBe(1);

    const decrypted = decrypt(encryptedData);
    expect(decrypted).toBe(plaintext);
  });

  it("should generate different IVs and ciphertexts for the same plaintext", () => {
    const plaintext = "same-text";
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1.iv).not.toBe(encrypted2.iv);
    expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
  });

  it("should throw when decrypting with tampered authTag", () => {
    const plaintext = "tamper-me";
    const encryptedData = encrypt(plaintext);

    // Tamper with the authTag by changing a character
    const tamperedAuthTag = encryptedData.authTag.replace(/[0-9a-f]/, "f");
    const modifiedData = {
      ...encryptedData,
      authTag:
        tamperedAuthTag === encryptedData.authTag
          ? encryptedData.authTag.replace(/[0-9a-f]/, "0")
          : tamperedAuthTag,
    };

    expect(() => decrypt(modifiedData)).toThrow();
  });

  it("should throw if TOKEN_ENCRYPTION_KEY is missing", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt("test")).toThrow(
      "TOKEN_ENCRYPTION_KEY environment variable is missing",
    );
  });

  it("should throw if TOKEN_ENCRYPTION_KEY is not 32 bytes", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "0123";
    expect(() => encrypt("test")).toThrow(
      "TOKEN_ENCRYPTION_KEY must be a 32-byte hex string",
    );
  });

  describe("Docker Compose & CI Secret Configuration", () => {
    const composePath = path.resolve(
      __dirname,
      "../../../../docker-compose.yml",
    );
    const ciPath = path.resolve(
      __dirname,
      "../../../../.github/workflows/ci.yml",
    );

    function extractServiceEnv(
      composeContent: string,
      service: string,
      key: string,
    ): string | undefined {
      const lines = composeContent.split(/\r?\n/);
      let currentService = "";
      let inEnv = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        if (
          /^[a-zA-Z0-9_-]+:\s*$/.test(line) &&
          !line.startsWith(" ") &&
          !line.startsWith("\t")
        ) {
          currentService = "";
          inEnv = false;
        } else if (/^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line)) {
          currentService = line.trim().replace(":", "");
          inEnv = false;
        } else if (
          currentService === service &&
          /^ {4}environment:\s*$/.test(line)
        ) {
          inEnv = true;
        } else if (inEnv && currentService === service) {
          if (/^ {6}[a-zA-Z0-9_]+:\s*.*/.test(line)) {
            const parts = line.trim().split(/:\s*(.+)/);
            if (parts[0] === key) {
              return parts[1];
            }
          } else if (!line.startsWith("      ")) {
            inEnv = false;
          }
        }
      }
      return undefined;
    }

    function extractDockerCiEnv(
      ciContent: string,
      key: string,
    ): string | undefined {
      const lines = ciContent.split(/\r?\n/);
      let inDockerJob = false;
      let inSmokeTest = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "docker:") {
          inDockerJob = true;
        } else if (
          inDockerJob &&
          /^[a-zA-Z0-9_-]+:\s*$/.test(line) &&
          !line.startsWith(" ")
        ) {
          inDockerJob = false;
        } else if (
          inDockerJob &&
          trimmed.includes("Smoke test Compose stack")
        ) {
          inSmokeTest = true;
        } else if (inSmokeTest && trimmed.startsWith("- name:")) {
          inSmokeTest = false;
        } else if (inSmokeTest && trimmed.startsWith(`${key}:`)) {
          return trimmed.split(/:\s*(.+)/)[1];
        }
      }
      return undefined;
    }

    it("requires an explicitly provided TOKEN_ENCRYPTION_KEY without default fallback in docker-compose.yml", () => {
      const composeContent = fs.readFileSync(composePath, "utf8");

      const apiEnv = extractServiceEnv(
        composeContent,
        "api",
        "TOKEN_ENCRYPTION_KEY",
      );
      const workerEnv = extractServiceEnv(
        composeContent,
        "worker",
        "TOKEN_ENCRYPTION_KEY",
      );

      expect(apiEnv).toBeDefined();
      expect(workerEnv).toBeDefined();

      // Must not contain hardcoded fallback (":-")
      expect(apiEnv).not.toContain(":-");
      expect(workerEnv).not.toContain(":-");

      // Must use required interpolation syntax (":?")
      expect(apiEnv).toContain(":?");
      expect(workerEnv).toContain(":?");

      // Both services must use identical required key interpolation
      expect(apiEnv).toBe(workerEnv);
    });

    it("explicitly provides test-only TOKEN_ENCRYPTION_KEY in GitHub Actions docker smoke test", () => {
      const ciContent = fs.readFileSync(ciPath, "utf8");
      const testKey = extractDockerCiEnv(ciContent, "TOKEN_ENCRYPTION_KEY");

      expect(testKey).toBe(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      );
    });
  });
});
