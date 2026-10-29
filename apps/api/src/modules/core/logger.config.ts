import { Params } from 'nestjs-pino';
import pino from 'pino';
import {
  CORRELATION_ID_REGEX,
  getOrCreateCorrelationId,
  attachCorrelationIdToResponse,
} from './correlation-id.utils';
import { sanitizeRequestUrl } from './url-sanitizer.utils';

export {
  CORRELATION_ID_REGEX,
  getOrCreateCorrelationId,
  attachCorrelationIdToResponse,
  sanitizeRequestUrl,
};

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
 * Scoped OAuth code/state redaction paths to avoid obscuring operational error codes
 * (e.g. { code: 'TRANSITION_FAILED' }) while ensuring authorization codes/state tokens
 * in query, body, and payload objects are strictly redacted.
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
  'params.code',
  'params.state',
  'data.code',
  'data.state',
];

export const API_REDACT_PATHS = [
  ...SENSITIVE_FIELDS,
  ...SENSITIVE_FIELDS.map((field) => `*.${field}`),
  ...SENSITIVE_FIELDS.map((field) => `*.*.${field}`),
  ...SENSITIVE_FIELDS.map((field) => `*.*.*.${field}`),
  ...SENSITIVE_FIELDS.map((field) => `*.*.*.*.${field}`),
  ...SENSITIVE_FIELDS.map((field) => `*.*.*.*.*.${field}`),
  ...SCOPED_OAUTH_PATHS,
  'req.headers.authorization',
  'req.headers.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["X-CSRF-Token"]',
  'req.headers["set-cookie"]',
  'req.headers["Set-Cookie"]',
  'res.headers["set-cookie"]',
  'res.headers["Set-Cookie"]',
  'res.headers.set-cookie',
  'req.query.session',
  'req.body.password',
  'req.body.accessToken',
  'req.body.access_token',
  'req.body.refreshToken',
  'req.body.refresh_token',
  'req.body.clientSecret',
  'req.body.client_secret',
  'req.body.encryptedTokens',
  'req.body.credentials',
];

export function getApiLogLevel(): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL.toLowerCase();
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export function validateAndAssignReqId(req: any, res?: any): string {
  const id = getOrCreateCorrelationId(req);
  attachCorrelationIdToResponse(res, id);
  return id;
}

export const loggerConfig: Params = {
  pinoHttp: {
    level: getApiLogLevel(),
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    redact: {
      paths: API_REDACT_PATHS,
      censor: '[REDACTED]',
    },
    genReqId: (req, res) => validateAndAssignReqId(req, res),
    customProps: () => ({
      context: 'HTTP',
    }),
    serializers: {
      req: (req: any) => {
        const urlStr = (req.url as string) || '';
        const headers = { ...req.headers };
        if (headers['x-csrf-token']) headers['x-csrf-token'] = '[REDACTED]';
        if (headers['X-CSRF-Token']) headers['X-CSRF-Token'] = '[REDACTED]';
        if (headers['authorization']) headers['authorization'] = '[REDACTED]';
        if (headers['Authorization']) headers['Authorization'] = '[REDACTED]';
        if (headers['cookie']) headers['cookie'] = '[REDACTED]';
        if (headers['Cookie']) headers['Cookie'] = '[REDACTED]';

        return {
          id: req.id,
          method: req.method,
          url: sanitizeRequestUrl(urlStr),
          headers,
          remoteAddress: req.remoteAddress,
          remotePort: req.remotePort,
        };
      },
      res: (res: any) => ({
        statusCode: res.statusCode,
        headers: res.headers,
      }),
    },
  },
};
