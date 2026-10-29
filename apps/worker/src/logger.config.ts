import pino, { LoggerOptions } from 'pino';
import { Params } from 'nestjs-pino';

export const SENSITIVE_FIELDS = [
  'password',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'clientSecret',
  'client_secret',
  'tokenSecret',
  'token_secret',
  'encryptedTokens',
  'encrypted_tokens',
  'credentials',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'x-csrf-token',
  'X-CSRF-Token',
  'set-cookie',
  'Set-Cookie',
  'setCookie',
  'csrfToken',
  'csrf_token',
];

/**
 * Scoped OAuth code/state redaction paths to avoid redacting operational error codes
 * (e.g. { code: 'MISSING_CAPABILITY' }) while ensuring authorization codes/tokens in
 * job payloads or error response bodies are redacted.
 */
export const SCOPED_OAUTH_PATHS = [
  'req.query.code',
  'req.query.state',
  'query.code',
  'query.state',
  'req.body.code',
  'req.body.state',
  'body.code',
  'body.state',
  'data.code',
  'data.state',
  'job.data.code',
  'job.data.state',
  'params.code',
  'params.state',
];

export const WORKER_REDACT_PATHS = [
  ...SENSITIVE_FIELDS,
  ...SENSITIVE_FIELDS.map((field) => `*.${field}`),
  ...SENSITIVE_FIELDS.map((field) => `*.*.${field}`),
  ...SENSITIVE_FIELDS.map((field) => `*.*.*.${field}`),
  ...SENSITIVE_FIELDS.map((field) => `*.*.*.*.${field}`),
  ...SENSITIVE_FIELDS.map((field) => `*.*.*.*.*.${field}`),
  ...SCOPED_OAUTH_PATHS,
  'data.password',
  'data.accessToken',
  'data.access_token',
  'data.refreshToken',
  'data.refresh_token',
  'data.clientSecret',
  'data.client_secret',
  'data.encryptedTokens',
  'data.credentials',
  'job.data.password',
  'job.data.accessToken',
  'job.data.access_token',
  'job.data.refreshToken',
  'job.data.refresh_token',
  'job.data.clientSecret',
  'job.data.client_secret',
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
