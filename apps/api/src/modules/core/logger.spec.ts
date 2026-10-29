import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pino from 'pino';
import {
  getApiLogLevel,
  validateAndAssignReqId,
  sanitizeRequestUrl,
  API_REDACT_PATHS,
  SENSITIVE_FIELDS,
  loggerConfig,
} from './logger.config';
import { AllExceptionsFilter } from '../../filters/all-exceptions.filter';
import { HttpException, HttpStatus } from '@nestjs/common';

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

  describe('Request Correlation ID Validation & Response Header', () => {
    it('accepts valid incoming correlation ID and sets x-request-id header', () => {
      const resHeaders: Record<string, string> = {};
      const mockRes = {
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

    it('rejects invalid correlation ID with spaces or invalid characters and generates fresh safe ID', () => {
      const resHeaders: Record<string, string> = {};
      const mockRes = {
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
      // Must be a valid UUID v7 format (hex with dashes)
      expect(reqId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(resHeaders['x-request-id']).toBe(reqId);
    });

    it('rejects oversized correlation ID (> 128 chars) and generates fresh safe ID', () => {
      const oversized = 'a'.repeat(200);
      const resHeaders: Record<string, string> = {};
      const mockRes = {
        setHeader: (k: string, v: string) => {
          resHeaders[k.toLowerCase()] = v;
        },
      };
      const mockReq = {
        headers: {
          'x-request-id': oversized,
        },
      };

      const reqId = validateAndAssignReqId(mockReq, mockRes);
      expect(reqId).not.toBe(oversized);
      expect(reqId.length).toBeLessThan(40);
      expect(resHeaders['x-request-id']).toBe(reqId);
    });

    it('generates a fresh UUID v7 when x-request-id is missing', () => {
      const resHeaders: Record<string, string> = {};
      const mockRes = {
        setHeader: (k: string, v: string) => {
          resHeaders[k.toLowerCase()] = v;
        },
      };
      const mockReq = { headers: {} };

      const reqId = validateAndAssignReqId(mockReq, mockRes);
      expect(reqId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(resHeaders['x-request-id']).toBe(reqId);
    });
  });

  describe('URL Query Sanitization', () => {
    it('sanitizes sensitive query params like code, state, token, and session', () => {
      const rawUrl =
        '/api/v1/oauth/callback?code=super-secret-code&state=oauth-state-123&session=sess-abc&safeParam=public-info';
      const sanitized = sanitizeRequestUrl(rawUrl);

      expect(sanitized).not.toContain('super-secret-code');
      expect(sanitized).not.toContain('oauth-state-123');
      expect(sanitized).not.toContain('sess-abc');
      expect(sanitized).toContain('code=%5BREDACTED%5D');
      expect(sanitized).toContain('state=%5BREDACTED%5D');
      expect(sanitized).toContain('session=%5BREDACTED%5D');
      expect(sanitized).toContain('safeParam=public-info');
    });

    it('leaves non-sensitive query strings intact', () => {
      const rawUrl = '/api/v1/posts?take=10&skip=0&order=desc';
      expect(sanitizeRequestUrl(rawUrl)).toBe(rawUrl);
    });
  });

  describe('Pino Structured JSON Output & Secret Redaction', () => {
    it('emits valid structured JSON with ISO timestamp, level, context, and message', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const testLogger = pino(
        {
          timestamp: pino.stdTimeFunctions.isoTime,
          formatters: {
            level: (label: string) => ({ level: label }),
          },
        },
        stream,
      );

      testLogger.info(
        { context: 'TestContext', correlationId: 'corr-123' },
        'Structured log message',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.level).toBe('info');
      expect(parsed.context).toBe('TestContext');
      expect(parsed.correlationId).toBe('corr-123');
      expect(parsed.msg).toBe('Structured log message');
      expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
    });

    it('redacts all required sensitive fields from logged objects and nested structures', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const testLogger = pino(
        {
          redact: {
            paths: API_REDACT_PATHS,
            censor: '[REDACTED]',
          },
        },
        stream,
      );

      // Verify each sensitive field is protected
      for (const field of SENSITIVE_FIELDS) {
        output = '';
        testLogger.info({ [field]: 'secret-value-123' }, 'Sensitive test');
        const parsed = JSON.parse(output.trim());
        expect(parsed[field]).toBe('[REDACTED]');
      }

      // Verify nested structure redaction
      output = '';
      testLogger.info(
        {
          user: { password: 'secret-password' },
          auth: {
            credentials: {
              accessToken: 'access-secret',
              refreshToken: 'refresh-secret',
            },
          },
          encryptedTokens: 'enc-blob',
        },
        'Nested test',
      );

      const nestedParsed = JSON.parse(output.trim());
      expect(nestedParsed.user.password).toBe('[REDACTED]');
      expect(nestedParsed.auth.credentials).toBe('[REDACTED]');
      expect(nestedParsed.encryptedTokens).toBe('[REDACTED]');
    });

    it('redacts sensitive fields on error objects without leaking secrets', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const testLogger = pino(
        {
          redact: {
            paths: API_REDACT_PATHS,
            censor: '[REDACTED]',
          },
        },
        stream,
      );

      const error: any = new Error('Provider failed');
      error.accessToken = 'secret-access-token';
      error.refreshToken = 'secret-refresh-token';

      testLogger.error(
        { err: error, correlationId: 'corr-999' },
        'OAuth error occurred',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.correlationId).toBe('corr-999');
      expect(parsed.err.message).toBe('Provider failed');
      expect(parsed.err.accessToken).toBe('[REDACTED]');
      expect(parsed.err.refreshToken).toBe('[REDACTED]');
    });

    it('req serializer sanitizes headers and does not expose body', () => {
      const pinoHttpOpts = loggerConfig.pinoHttp as any;
      const reqSerializer = pinoHttpOpts.serializers.req;

      const mockReq = {
        id: 'req-uuid',
        method: 'POST',
        url: '/api/v1/auth/login?code=secret-code',
        headers: {
          authorization: 'Bearer secret-jwt-token',
          cookie: 'session=secret-cookie',
          'x-csrf-token': 'secret-csrf',
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
      expect(serialized.headers['cookie']).toBe('[REDACTED]');
      expect(serialized.headers['x-csrf-token']).toBe('[REDACTED]');
      expect(serialized.headers['content-type']).toBe('application/json');
      expect(serialized.url).not.toContain('secret-code');
      // Body must not be serialized into the request log object
      expect(serialized.body).toBeUndefined();
    });
  });

  describe('AllExceptionsFilter Observability', () => {
    it('sets x-request-id response header and returns structured error with correlation id', () => {
      const filter = new AllExceptionsFilter();

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
    });

    it('handles 500 error and logs error with correlation id', () => {
      const filter = new AllExceptionsFilter();

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
        id: 'corr-500-123',
        url: '/api/v1/accounts/123/sync',
        method: 'POST',
        headers: {},
      };

      const mockHost: any = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      };

      const error = new Error('Database connection failed');
      filter.catch(error, mockHost);

      expect(responseStatusCode).toBe(500);
      expect(resHeaders['x-request-id']).toBe('corr-500-123');
      expect(responseJson.error.code).toBe('InternalServerError');
      expect(responseJson.error.requestId).toBe('corr-500-123');
    });
  });
});
