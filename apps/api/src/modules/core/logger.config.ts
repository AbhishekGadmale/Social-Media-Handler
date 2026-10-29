import { Params } from 'nestjs-pino';
import pino from 'pino';
import { generateId } from '@agency-os/database';

export const CORRELATION_ID_REGEX = /^[a-zA-Z0-9._-]{1,128}$/;

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

export const API_REDACT_PATHS = [
  ...SENSITIVE_FIELDS,
  ...SENSITIVE_FIELDS.map((field) => `*.${field}`),
  ...SENSITIVE_FIELDS.map((field) => `*.*.${field}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'res.headers.set-cookie',
  'req.query.code',
  'req.query.state',
  'req.query.session',
  'req.query.csrfToken',
  'req.body.password',
  'req.body.accessToken',
  'req.body.refreshToken',
  'req.body.encryptedTokens',
  'req.body.code',
  'req.body.state',
  'req.body.credentials',
];

export function getApiLogLevel(): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL.toLowerCase();
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export function validateAndAssignReqId(req: any, res?: any): string {
  const raw = req.headers ? req.headers['x-request-id'] : undefined;
  const incoming = Array.isArray(raw) ? raw[0] : raw;
  const id =
    typeof incoming === 'string' && CORRELATION_ID_REGEX.test(incoming)
      ? incoming
      : generateId();

  if (res && typeof res.setHeader === 'function') {
    res.setHeader('x-request-id', id);
  }

  return id;
}

export function sanitizeRequestUrl(urlStr: string): string {
  if (!urlStr) return '';
  try {
    const parsedUrl = new URL(urlStr, 'http://localhost');
    const sensitiveQueryParams = [
      'code',
      'state',
      'session',
      'csrfToken',
      'token',
      'accessToken',
      'refreshToken',
    ];
    let modified = false;
    for (const param of sensitiveQueryParams) {
      if (parsedUrl.searchParams.has(param)) {
        parsedUrl.searchParams.set(param, '[REDACTED]');
        modified = true;
      }
    }
    return modified ? parsedUrl.pathname + parsedUrl.search : urlStr;
  } catch {
    return urlStr.split('?')[0];
  }
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
        if (headers['x-csrf-token']) {
          headers['x-csrf-token'] = '[REDACTED]';
        }
        if (headers['authorization']) {
          headers['authorization'] = '[REDACTED]';
        }
        if (headers['cookie']) {
          headers['cookie'] = '[REDACTED]';
        }

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
