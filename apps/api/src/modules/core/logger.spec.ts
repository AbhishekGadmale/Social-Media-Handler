import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pino from 'pino';
import {
  getApiLogLevel,
  validateAndAssignReqId,
  sanitizeRequestUrl,
  API_REDACT_PATHS,
  SENSITIVE_FIELDS,
  SCOPED_OAUTH_PATHS,
  loggerConfig,
} from './logger.config';
import {
  isValidCorrelationId,
  extractCorrelationId,
  getOrCreateCorrelationId,
  attachCorrelationIdToResponse,
} from './correlation-id.utils';
import { AllExceptionsFilter } from '../../filters/all-exceptions.filter';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';

describe('API Structured Pino Logger & Correlation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Log Level Configuration', () => {
    it('defaults to info in production when LOG_LEVEL is unset', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'production';
      expect(getApiLogLevel()).toBe('info');
    });

    it('defaults to debug in development when LOG_LEVEL is unset', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'development';
      expect(getApiLogLevel()).toBe('debug');
    });

    it('respects LOG_LEVEL environment variable regardless of NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'warn';
      expect(getApiLogLevel()).toBe('warn');

      process.env.LOG_LEVEL = 'TRACE';
      expect(getApiLogLevel()).toBe('trace');
    });
  });

  describe('Correlation ID Utilities & Request ID Validation', () => {
    it('validates correlation ID format correctly', () => {
      expect(isValidCorrelationId('valid-corr-id-123')).toBe(true);
      expect(isValidCorrelationId('trace_id.456-789')).toBe(true);
      expect(isValidCorrelationId('')).toBe(false);
      expect(isValidCorrelationId('has spaces')).toBe(false);
      expect(isValidCorrelationId('malicious\r\nheader')).toBe(false);
      expect(isValidCorrelationId('a'.repeat(129))).toBe(false);
      expect(isValidCorrelationId('a'.repeat(128))).toBe(true);
    });

    it('extracts correlation ID prioritizing req.id over headers', () => {
      const reqWithId = {
        id: 'middleware-assigned-id',
        headers: { 'x-request-id': 'header-id' },
      };
      expect(extractCorrelationId(reqWithId)).toBe('middleware-assigned-id');

      const reqWithOnlyHeader = {
        headers: { 'x-request-id': 'header-id' },
      };
      expect(extractCorrelationId(reqWithOnlyHeader)).toBe('header-id');
    });

    it('safely handles array-valued x-request-id headers', () => {
      const reqWithArray = {
        headers: { 'x-request-id': ['array-id-1', 'array-id-2'] },
      };
      expect(extractCorrelationId(reqWithArray)).toBe('array-id-1');
    });

    it('ignores invalid incoming correlation IDs in extractCorrelationId', () => {
      const reqWithInvalid = {
        headers: { 'x-request-id': 'malicious<script>' },
      };
      expect(extractCorrelationId(reqWithInvalid)).toBeUndefined();
    });

    it('generates a fresh UUID when no valid correlation ID exists', () => {
      const reqEmpty = { headers: {} };
      const id = getOrCreateCorrelationId(reqEmpty);
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('attaches correlation ID to response only if headers not sent', () => {
      const headers: Record<string, string> = {};
      const resOpen = {
        headersSent: false,
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
      };
      attachCorrelationIdToResponse(resOpen, 'test-corr-id');
      expect(headers['x-request-id']).toBe('test-corr-id');

      const setHeaderSpy = vi.fn();
      const resSent = {
        headersSent: true,
        setHeader: setHeaderSpy,
      };
      attachCorrelationIdToResponse(resSent, 'test-corr-id');
      expect(setHeaderSpy).not.toHaveBeenCalled();
    });

    it('validateAndAssignReqId accepts valid incoming ID and sets header', () => {
      const resHeaders: Record<string, string> = {};
      const mockRes = {
        headersSent: false,
        setHeader: (k: string, v: string) => {
          resHeaders[k.toLowerCase()] = v;
        },
      };
      const mockReq = {
        headers: {
          'x-request-id': 'req-corr-uuid-1234',
        },
      };

      const reqId = validateAndAssignReqId(mockReq, mockRes);
      expect(reqId).toBe('req-corr-uuid-1234');
      expect(resHeaders['x-request-id']).toBe('req-corr-uuid-1234');
    });

    it('validateAndAssignReqId rejects invalid correlation ID and generates safe UUID', () => {
      const resHeaders: Record<string, string> = {};
      const mockRes = {
        headersSent: false,
        setHeader: (k: string, v: string) => {
          resHeaders[k.toLowerCase()] = v;
        },
      };
      const mockReq = {
        headers: {
          'x-request-id': 'invalid id with spaces & malicious <script>',
        },
      };

      const reqId = validateAndAssignReqId(mockReq, mockRes);
      expect(reqId).not.toContain('spaces');
      expect(reqId).not.toContain('<script>');
      expect(reqId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(resHeaders['x-request-id']).toBe(reqId);
    });
  });

  describe('URL Query Sanitization', () => {
    it('sanitizes sensitive query params like code, state, token, accessToken, refreshToken, clientSecret', () => {
      const rawUrl =
        '/api/v1/oauth/callback?code=super-secret-code&state=oauth-state-123&session=sess-abc&accessToken=tok-123&refreshToken=ref-456&clientSecret=sec-789&safeParam=public-info';
      const sanitized = sanitizeRequestUrl(rawUrl);

      expect(sanitized).not.toContain('super-secret-code');
      expect(sanitized).not.toContain('oauth-state-123');
      expect(sanitized).not.toContain('sess-abc');
      expect(sanitized).not.toContain('tok-123');
      expect(sanitized).not.toContain('ref-456');
      expect(sanitized).not.toContain('sec-789');
      expect(sanitized).toContain('code=[REDACTED]');
      expect(sanitized).toContain('state=[REDACTED]');
      expect(sanitized).toContain('safeParam=public-info');
    });

    it('leaves non-sensitive query strings intact', () => {
      const rawUrl = '/api/v1/posts?take=10&skip=0&order=desc';
      expect(sanitizeRequestUrl(rawUrl)).toBe(rawUrl);
    });

    it('handles relative paths and absolute URLs gracefully', () => {
      const relative = '/path/to/resource?code=secret123';
      expect(sanitizeRequestUrl(relative)).toBe(
        '/path/to/resource?code=[REDACTED]',
      );

      const absolute = 'http://example.com/api?code=secret123';
      expect(sanitizeRequestUrl(absolute)).toBe(
        'http://example.com/api?code=[REDACTED]',
      );
    });
  });

  describe('Configured API Pino Logger Secret Redaction & Operational Code Preservation', () => {
    it('emits valid structured JSON using actual loggerConfig pinoHttp options', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const testLogger = pino(
        {
          ...(loggerConfig.pinoHttp as any),
        },
        stream,
      );

      testLogger.info(
        { context: 'TestContext', correlationId: 'corr-123' },
        'Structured log message',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.level).toBe('info');
      expect(parsed.correlationId).toBe('corr-123');
      expect(parsed.msg).toBe('Structured log message');
      expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
    });

    it('preserves top-level and nested operational error codes (L1 requirement)', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const testLogger = pino(
        {
          ...(loggerConfig.pinoHttp as any),
        },
        stream,
      );

      testLogger.warn(
        {
          code: 'TRANSITION_FAILED',
          error: { code: 'DATABASE_LOCKED' },
          err: { code: 'ECONNREFUSED' },
        },
        'Operational error code test',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.code).toBe('TRANSITION_FAILED');
      expect(parsed.error.code).toBe('DATABASE_LOCKED');
      expect(parsed.err.code).toBe('ECONNREFUSED');
    });

    it('redacts scoped OAuth code and state in query and body shapes (L1 requirement)', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const testLogger = pino(
        {
          ...(loggerConfig.pinoHttp as any),
        },
        stream,
      );

      testLogger.info(
        {
          query: { code: 'q-code-secret', state: 'q-state-secret' },
          body: { code: 'b-code-secret', state: 'b-state-secret' },
          params: { code: 'p-code-secret', state: 'p-state-secret' },
          data: { code: 'd-code-secret', state: 'd-state-secret' },
        },
        'OAuth code redaction',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.query.code).toBe('[REDACTED]');
      expect(parsed.query.state).toBe('[REDACTED]');
      expect(parsed.body.code).toBe('[REDACTED]');
      expect(parsed.body.state).toBe('[REDACTED]');
      expect(parsed.params.code).toBe('[REDACTED]');
      expect(parsed.params.state).toBe('[REDACTED]');
      expect(parsed.data.code).toBe('[REDACTED]');
      expect(parsed.data.state).toBe('[REDACTED]');
    });

    it('redacts sensitive headers across both lower and title casings (L2 requirement)', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const testLogger = pino(
        {
          ...(loggerConfig.pinoHttp as any),
        },
        stream,
      );

      testLogger.info(
        {
          req: {
            headers: {
              authorization: 'Bearer lowercase_auth',
              Authorization: 'Bearer titlecase_auth',
              cookie: 'session=lower_cookie',
              Cookie: 'session=title_cookie',
              'x-csrf-token': 'lower_csrf',
              'X-CSRF-Token': 'title_csrf',
              'set-cookie': 'lower_set',
              'Set-Cookie': 'title_set',
            },
          },
        },
        'Header casing test',
      );

      const parsed = JSON.parse(output.trim());
      const h = parsed.req.headers;
      expect(h.authorization).toBe('[REDACTED]');
      expect(h.Authorization).toBe('[REDACTED]');
      expect(h.cookie).toBe('[REDACTED]');
      expect(h.Cookie).toBe('[REDACTED]');
      expect(h['x-csrf-token']).toBe('[REDACTED]');
      expect(h['X-CSRF-Token']).toBe('[REDACTED]');
      expect(h['set-cookie']).toBe('[REDACTED]');
      expect(h['Set-Cookie']).toBe('[REDACTED]');
    });

    it('redacts deeply nested error structures like err.config.headers and err.response.data (M3 requirement)', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const testLogger = pino(
        {
          ...(loggerConfig.pinoHttp as any),
        },
        stream,
      );

      testLogger.error(
        {
          err: {
            config: {
              headers: {
                Authorization: 'Bearer nested_axios_auth_secret',
                authorization: 'Bearer nested_lower_auth_secret',
              },
            },
            response: {
              data: {
                access_token: 'nested_access_token_secret',
                accessToken: 'nested_camel_access_secret',
                refresh_token: 'nested_refresh_token_secret',
                refreshToken: 'nested_camel_refresh_secret',
                client_secret: 'nested_client_secret_xyz',
                clientSecret: 'nested_camel_client_secret_xyz',
              },
            },
          },
        },
        'Deep Axios error structure test',
      );

      expect(output).not.toContain('nested_axios_auth_secret');
      expect(output).not.toContain('nested_lower_auth_secret');
      expect(output).not.toContain('nested_access_token_secret');
      expect(output).not.toContain('nested_camel_access_secret');
      expect(output).not.toContain('nested_refresh_token_secret');
      expect(output).not.toContain('nested_camel_refresh_secret');
      expect(output).not.toContain('nested_client_secret_xyz');
      expect(output).not.toContain('nested_camel_client_secret_xyz');

      const parsed = JSON.parse(output.trim());
      expect(parsed.err.config.headers.Authorization).toBe('[REDACTED]');
      expect(parsed.err.config.headers.authorization).toBe('[REDACTED]');
      expect(parsed.err.response.data.access_token).toBe('[REDACTED]');
      expect(parsed.err.response.data.client_secret).toBe('[REDACTED]');
      expect(parsed.err.response.data.refresh_token).toBe('[REDACTED]');
    });

    it('req serializer sanitizes headers and does not expose body', () => {
      const pinoHttpOpts = loggerConfig.pinoHttp as any;
      const reqSerializer = pinoHttpOpts.serializers.req;

      const mockReq = {
        id: 'req-uuid',
        method: 'POST',
        url: '/api/v1/auth/login?code=secret-code&client_secret=secret-client',
        headers: {
          authorization: 'Bearer secret-jwt-token',
          Authorization: 'Bearer title-secret-jwt',
          cookie: 'session=secret-cookie',
          Cookie: 'session=title-secret-cookie',
          'x-csrf-token': 'secret-csrf',
          'X-CSRF-Token': 'title-secret-csrf',
          'content-type': 'application/json',
        },
        body: {
          password: 'plain-text-password',
        },
        remoteAddress: '127.0.0.1',
        remotePort: 12345,
      };

      const serialized = reqSerializer(mockReq);
      expect(serialized.id).toBe('req-uuid');
      expect(serialized.headers['authorization']).toBe('[REDACTED]');
      expect(serialized.headers['Authorization']).toBe('[REDACTED]');
      expect(serialized.headers['cookie']).toBe('[REDACTED]');
      expect(serialized.headers['Cookie']).toBe('[REDACTED]');
      expect(serialized.headers['x-csrf-token']).toBe('[REDACTED]');
      expect(serialized.headers['X-CSRF-Token']).toBe('[REDACTED]');
      expect(serialized.headers['content-type']).toBe('application/json');
      expect(serialized.url).not.toContain('secret-code');
      expect(serialized.url).not.toContain('secret-client');
      expect(serialized.url).toContain('code=[REDACTED]');
      expect(serialized.url).toContain('client_secret=[REDACTED]');
      expect(serialized.body).toBeUndefined();
    });
  });

  describe('AllExceptionsFilter 5xx Credential Leakage & Observability (B2 requirement)', () => {
    it('sets x-request-id response header and returns structured error with correlation id', () => {
      const mockLogger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        setContext: vi.fn(),
      };

      const filter = new AllExceptionsFilter(
        mockLogger as unknown as PinoLogger,
      );

      const resHeaders: Record<string, string> = {};
      let responseStatusCode = 0;
      let responseJson: any = null;

      const mockResponse: any = {
        headersSent: false,
        setHeader: (k: string, v: string) => {
          resHeaders[k.toLowerCase()] = v;
        },
        status: (code: number) => {
          responseStatusCode = code;
          return {
            json: (payload: any) => {
              responseJson = payload;
            },
          };
        },
      };

      const mockRequest: any = {
        id: 'corr-exception-123',
        url: '/api/v1/posts',
        method: 'GET',
        headers: {},
      };

      const mockHost: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      };

      const error = new HttpException(
        'Validation error',
        HttpStatus.BAD_REQUEST,
      );
      filter.catch(error, mockHost);

      expect(responseStatusCode).toBe(400);
      expect(resHeaders['x-request-id']).toBe('corr-exception-123');
      expect(responseJson).toEqual({
        error: {
          code: 'HttpException',
          message: 'Validation error',
          requestId: 'corr-exception-123',
        },
      });
      // 4xx should NOT log to error logger
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('B2 Regression: sanitizes URL in Error 5xx logging branch and prevents credential leakage', () => {
      const mockLogger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        setContext: vi.fn(),
      };

      const filter = new AllExceptionsFilter(
        mockLogger as unknown as PinoLogger,
      );

      const mockResponse: any = {
        headersSent: false,
        setHeader: vi.fn(),
        status: () => ({ json: vi.fn() }),
      };

      const sensitiveUrl =
        '/api/v1/oauth/callback?code=super_secret_oauth_code_123&state=state_token_456&access_token=token_secret_789&client_secret=client_secret_xyz';

      const mockRequest: any = {
        id: 'corr-500-error',
        url: sensitiveUrl,
        method: 'GET',
        headers: {},
      };

      const mockHost: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      };

      const error = new Error('OAuth token exchange network timeout');
      filter.catch(error, mockHost);

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const [loggedMeta, loggedMsg] = (mockLogger.error as any).mock.calls[0];

      expect(loggedMsg).toBe('OAuth token exchange network timeout');
      expect(loggedMeta.path).not.toContain('super_secret_oauth_code_123');
      expect(loggedMeta.path).not.toContain('state_token_456');
      expect(loggedMeta.path).not.toContain('token_secret_789');
      expect(loggedMeta.path).not.toContain('client_secret_xyz');
      expect(loggedMeta.path).toContain('code=[REDACTED]');
      expect(loggedMeta.path).toContain('state=[REDACTED]');
      expect(loggedMeta.path).toContain('access_token=[REDACTED]');
      expect(loggedMeta.path).toContain('client_secret=[REDACTED]');
      expect(loggedMeta.requestId).toBe('corr-500-error');
      expect(loggedMeta.statusCode).toBe(500);
    });

    it('B2 Regression: sanitizes URL in non-Error 5xx logging branch and prevents credential leakage', () => {
      const mockLogger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        setContext: vi.fn(),
      };

      const filter = new AllExceptionsFilter(
        mockLogger as unknown as PinoLogger,
      );

      const mockResponse: any = {
        headersSent: false,
        setHeader: vi.fn(),
        status: () => ({ json: vi.fn() }),
      };

      const sensitiveUrl =
        '/api/v1/oauth/callback?code=super_secret_raw_reject&state=state_raw_reject';

      const mockRequest: any = {
        id: 'corr-500-raw',
        url: sensitiveUrl,
        method: 'POST',
        headers: {},
      };

      const mockHost: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      };

      // Non-Error exception thrown (e.g. raw string / promise rejection)
      filter.catch('Uncaught promise string rejection', mockHost);

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const [loggedMeta, loggedMsg] = (mockLogger.error as any).mock.calls[0];

      expect(loggedMsg).toBe('Unhandled exception');
      expect(loggedMeta.path).not.toContain('super_secret_raw_reject');
      expect(loggedMeta.path).not.toContain('state_raw_reject');
      expect(loggedMeta.path).toContain('code=[REDACTED]');
      expect(loggedMeta.path).toContain('state=[REDACTED]');
      expect(loggedMeta.requestId).toBe('corr-500-raw');
      expect(loggedMeta.statusCode).toBe(500);
    });

    it('handles missing or invalid correlation ID by generating safe fallback in filter', () => {
      const mockLogger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        setContext: vi.fn(),
      };

      const filter = new AllExceptionsFilter(
        mockLogger as unknown as PinoLogger,
      );

      const resHeaders: Record<string, string> = {};
      let responseJson: any = null;
      const mockResponse: any = {
        headersSent: false,
        setHeader: (k: string, v: string) => {
          resHeaders[k.toLowerCase()] = v;
        },
        status: () => ({
          json: (p: any) => {
            responseJson = p;
          },
        }),
      };

      const mockRequest: any = {
        url: '/api/v1/posts',
        method: 'GET',
        headers: {
          'x-request-id': 'invalid malicious <script> header',
        },
      };

      const mockHost: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      };

      filter.catch(new Error('Internal failure'), mockHost);

      const assignedId = resHeaders['x-request-id'];
      expect(assignedId).not.toContain('<script>');
      expect(assignedId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(responseJson.error.requestId).toBe(assignedId);
    });
  });
});
