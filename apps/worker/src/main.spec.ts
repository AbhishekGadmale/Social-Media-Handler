import { NestFactory } from '@nestjs/core';
import { bootstrap } from './main';

const createMock = jest.fn();

jest.mock('@nestjs/core', () => {
  const actual =
    jest.requireActual<typeof import('@nestjs/core')>('@nestjs/core');
  return {
    ...actual,
    NestFactory: {
      ...actual.NestFactory,
      create: (...args: unknown[]) => createMock(...args),
    },
  };
});

describe('Worker Bootstrap', () => {
  const originalEnv = process.env;
  const validKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  let mockLogger: {
    log: jest.Mock;
    error: jest.Mock;
  };
  let mockApp: {
    get: jest.Mock;
    useLogger: jest.Mock;
    listen: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, NODE_ENV: 'test' };

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    mockApp = {
      get: jest.fn().mockReturnValue(mockLogger),
      useLogger: jest.fn(),
      listen: jest.fn().mockResolvedValue(undefined),
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
    expect(mockApp.listen).toHaveBeenCalledWith(3002);
    expect(mockLogger.log).toHaveBeenCalledWith('Worker startup completed');
  });
});
