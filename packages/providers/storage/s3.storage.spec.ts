import { describe, it, expect, vi } from "vitest";
import { S3ObjectStorage } from "./s3.storage";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Mock the AWS SDK presigner
vi.mock("@aws-sdk/s3-request-presigner", () => {
  return {
    getSignedUrl: vi
      .fn()
      .mockResolvedValue("https://mocked-signed-url.com/key?sig=123"),
  };
});

// Mock S3Client
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({
      send: vi.fn(),
    })),
  };
});

describe("S3ObjectStorage", () => {
  it("delegates getSignedReadUrl correctly", async () => {
    const storage = new S3ObjectStorage({
      bucket: "test-bucket",
      region: "us-east-1",
      endpoint: "https://s3.amazonaws.com",
      accessKeyId: "key",
      secretAccessKey: "secret",
    });

    const url = await storage.getSignedReadUrl("test/image.jpg", 300);

    // We expect it to return the mocked presigned URL
    expect(url).toBe("https://mocked-signed-url.com/key?sig=123");

    // We can also verify the presigner was called with the right GetObjectCommand
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    expect(getSignedUrl).toHaveBeenCalledTimes(1);

    const callArgs = (getSignedUrl as any).mock.calls[0];
    const client = callArgs[0];
    const command = callArgs[1];
    const options = callArgs[2];

    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input.Bucket).toBe("test-bucket");
    expect(command.input.Key).toBe("test/image.jpg");
    expect(options.expiresIn).toBe(300);
  });
});
