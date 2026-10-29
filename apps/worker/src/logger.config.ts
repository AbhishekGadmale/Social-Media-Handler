import pino, { LoggerOptions } from 'pino';
import { Params } from 'nestjs-pino';

export const SENSITIVE_FIELDS = [
  'password',
  'authorization',
  'cookie',
  'set-cookie',
  'setCookie',
  'x-csrf-token',
  'csrfToken',
  'code',
  'state',
  'accessToken',
  'refreshToken',
  'encryptedTokens',
  'credentials',
];

export const WORKER_REDACT_PATHS = [
  ...SENSITIVE_FIELDS,
  ...SENSITIVE_FIELDS.map((field) => `*.${field}`),
  ...SENSITIVE_FIELDS.map((field) => `*.*.${field}`),
  'data.password',
  'data.code',
  'data.state',
  'data.accessToken',
  'data.refreshToken',
  'data.encryptedTokens',
  'data.credentials',
  'job.data.password',
  'job.data.code',
  'job.data.state',
  'job.data.accessToken',
  'job.data.refreshToken',
  'job.data.encryptedTokens',
  'job.data.credentials',
];

export function getWorkerLogLevel(): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL.toLowerCase();
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export function buildWorkerPinoOptions(
  overrides?: Partial<LoggerOptions>,
): LoggerOptions {
  return {
    level: getWorkerLogLevel(),
    redact: {
      paths: WORKER_REDACT_PATHS,
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    ...overrides,
  };
}

export const workerPinoOptions = buildWorkerPinoOptions();
export const workerLogger = pino(workerPinoOptions);

export const loggerConfig: Params = {
  pinoHttp: {
    logger: workerLogger,
  },
};
