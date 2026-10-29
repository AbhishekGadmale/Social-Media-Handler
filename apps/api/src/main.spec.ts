import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrap } from './main';

const createMock = vi.fn();

vi.mock('@nestjs/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nestjs/core')>();
  return {
    ...actual,
    NestFactory: {
      ...actual.NestFactory,
      create: (...args: unknown[]) => createMock(...args),
    },
  };
});

vi.mock('./config/trust-proxy', () => ({
  configureTrustProxy: vi.fn(),
}));

vi.mock('./config/public-url', () => ({
  getPublicApiUrl: vi.fn(),
}));

describe('API Bootstrap', () => {
  const originalEnv = process.env;
  const validKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  let mockApp: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    mockApp = {
      useLogger: vi.fn(),
      get: vi.fn().mockReturnValue({}),
      resolve: vi.fn().mockResolvedValue({}),
      enableCors: vi.fn(),
      use: vi.fn(),
      setGlobalPrefix: vi.fn(),
      useGlobalFilters: vi.fn(),
      useGlobalPipes: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
      getUrl: vi.fn().mockResolvedValue('http://localhost:3001'),
    };
    createMock.mockResolvedValue(mockApp);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails fast and does not create the Nest application if TOKEN_ENCRYPTION_KEY is missing', async () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;

    await expect(bootstrap()).rejects.toThrow(
      'TOKEN_ENCRYPTION_KEY environment variable is missing.',
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it('fails fast and does not create the Nest application if TOKEN_ENCRYPTION_KEY is invalid', async () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'invalid-short-key';

    await expect(bootstrap()).rejects.toThrow(
      'TOKEN_ENCRYPTION_KEY must be a 32-byte hex string.',
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it('initializes Nest application when TOKEN_ENCRYPTION_KEY is valid', async () => {
    delete process.env.PORT;
    process.env.TOKEN_ENCRYPTION_KEY = validKey;

    await expect(bootstrap()).resolves.toBeUndefined();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(mockApp.listen).toHaveBeenCalledWith(3001);
  });
});
