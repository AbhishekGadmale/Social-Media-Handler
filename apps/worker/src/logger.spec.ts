import pino from 'pino';
import {
  getWorkerLogLevel,
  buildWorkerPinoOptions,
  WORKER_REDACT_PATHS,
  SENSITIVE_FIELDS,
} from './logger.config';
import { SyncJobData } from './sync/sync.types';
import {
  PublishJobData,
  PublishDeleteJobData,
} from './publishing/publishing.types';

describe('Worker Standalone Pino Logger & Job Correlation', () => {
  const originalEnv = process.env;

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
      expect(getWorkerLogLevel()).toBe('info');
    });

    it('defaults to debug in development when LOG_LEVEL is unset', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'development';
      expect(getWorkerLogLevel()).toBe('debug');
    });

    it('respects LOG_LEVEL environment variable regardless of NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      process.env.LOG_LEVEL = 'warn';
      expect(getWorkerLogLevel()).toBe('warn');

      process.env.LOG_LEVEL = 'ERROR';
      expect(getWorkerLogLevel()).toBe('error');
    });
  });

  describe('Structured JSON Logging Output', () => {
    it('emits valid structured JSON with ISO timestamp, level, context, and message', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const options = buildWorkerPinoOptions({
        level: 'info',
      });
      const testLogger = pino(options, stream);

      testLogger.info(
        {
          context: 'SyncProcessor',
          correlationId: 'job-corr-123',
          jobId: 'job-1',
        },
        'Processing job in worker',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.level).toBe('info');
      expect(parsed.context).toBe('SyncProcessor');
      expect(parsed.correlationId).toBe('job-corr-123');
      expect(parsed.jobId).toBe('job-1');
      expect(parsed.msg).toBe('Processing job in worker');
      expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
    });
  });

  describe('Secret Redaction & Operational Code Preservation', () => {
    it('redacts all required sensitive fields from logged objects', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const options = buildWorkerPinoOptions({ level: 'info' });
      const testLogger = pino(options, stream);

      for (const field of SENSITIVE_FIELDS) {
        output = '';
        testLogger.info(
          { [field]: 'secret-token-material' },
          'Redaction check',
        );
        const parsed = JSON.parse(output.trim());
        expect(parsed[field]).toBe('[REDACTED]');
      }
    });

    it('preserves top-level and nested operational error codes (L1 requirement)', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const options = buildWorkerPinoOptions({ level: 'info' });
      const testLogger = pino(options, stream);

      testLogger.warn(
        {
          code: 'MISSING_CAPABILITY',
          error: { code: 'STALE_METADATA' },
          msg: 'publication.failed',
        },
        'Operation failure',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.code).toBe('MISSING_CAPABILITY');
      expect(parsed.error.code).toBe('STALE_METADATA');
    });

    it('redacts snake_case credential variants and nested structures (M3 requirement)', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const options = buildWorkerPinoOptions({ level: 'info' });
      const testLogger = pino(options, stream);

      testLogger.error(
        {
          err: {
            config: {
              headers: {
                Authorization: 'Bearer worker_nested_bearer_token',
                authorization: 'Bearer worker_lower_bearer_token',
              },
            },
            response: {
              data: {
                access_token: 'worker_access_token_secret',
                refresh_token: 'worker_refresh_token_secret',
                client_secret: 'worker_client_secret_secret',
              },
            },
          },
        },
        'Worker error redaction',
      );

      expect(output).not.toContain('worker_nested_bearer_token');
      expect(output).not.toContain('worker_lower_bearer_token');
      expect(output).not.toContain('worker_access_token_secret');
      expect(output).not.toContain('worker_refresh_token_secret');
      expect(output).not.toContain('worker_client_secret_secret');

      const parsed = JSON.parse(output.trim());
      expect(parsed.err.config.headers.Authorization).toBe('[REDACTED]');
      expect(parsed.err.config.headers.authorization).toBe('[REDACTED]');
      expect(parsed.err.response.data.access_token).toBe('[REDACTED]');
      expect(parsed.err.response.data.refresh_token).toBe('[REDACTED]');
      expect(parsed.err.response.data.client_secret).toBe('[REDACTED]');
    });

    it('redacts nested and BullMQ job data paths', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const options = buildWorkerPinoOptions({ level: 'info' });
      const testLogger = pino(options, stream);

      testLogger.info(
        {
          data: {
            accessToken: 'nested-secret-access',
            access_token: 'nested-snake-access',
            refreshToken: 'nested-secret-refresh',
            refresh_token: 'nested-snake-refresh',
            credentials: 'secret-credentials',
          },
          job: {
            data: {
              code: 'auth-code-123',
              state: 'state-secret-456',
            },
          },
          encryptedTokens: 'enc-blob-xyz',
        },
        'Job data logging',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.data.accessToken).toBe('[REDACTED]');
      expect(parsed.data.access_token).toBe('[REDACTED]');
      expect(parsed.data.refreshToken).toBe('[REDACTED]');
      expect(parsed.data.refresh_token).toBe('[REDACTED]');
      expect(parsed.data.credentials).toBe('[REDACTED]');
      expect(parsed.job.data.code).toBe('[REDACTED]');
      expect(parsed.job.data.state).toBe('[REDACTED]');
      expect(parsed.encryptedTokens).toBe('[REDACTED]');
    });
  });

  describe('Correlation ID & Backward Compatibility (M2 requirement)', () => {
    it('propagates correlationId and operationId across job metadata in worker logs', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const options = buildWorkerPinoOptions({ level: 'info' });
      const testLogger = pino(options, stream);

      const publishJob: PublishJobData = {
        publicationId: 'pub-abc-123',
        workspaceId: 'ws-xyz-456',
        dispatchVersion: 2,
        correlationId: 'req-corr-uuid-789',
        operationId: 'op-corr-uuid-101',
      };

      const jobMeta = {
        jobId: 'job-publish-1',
        publicationId: publishJob.publicationId,
        workspaceId: publishJob.workspaceId,
        dispatchVersion: publishJob.dispatchVersion,
        ...(publishJob.operationId
          ? { operationId: publishJob.operationId }
          : {}),
        ...(publishJob.correlationId
          ? { correlationId: publishJob.correlationId }
          : {}),
      };

      testLogger.info({
        msg: 'publication.claimed',
        attemptId: 'att-1',
        ...jobMeta,
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.msg).toBe('publication.claimed');
      expect(parsed.jobId).toBe('job-publish-1');
      expect(parsed.publicationId).toBe('pub-abc-123');
      expect(parsed.workspaceId).toBe('ws-xyz-456');
      expect(parsed.correlationId).toBe('req-corr-uuid-789');
      expect(parsed.operationId).toBe('op-corr-uuid-101');
    });

    it('correctly handles delete jobs with correlationId', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const options = buildWorkerPinoOptions({ level: 'info' });
      const testLogger = pino(options, stream);

      const deleteJob: PublishDeleteJobData = {
        publicationId: 'pub-delete-123',
        workspaceId: 'ws-delete-456',
        correlationId: 'corr-delete-789',
      };

      const jobMeta = {
        jobId: 'job-delete-1',
        publicationId: deleteJob.publicationId,
        workspaceId: deleteJob.workspaceId,
        ...(deleteJob.correlationId
          ? { correlationId: deleteJob.correlationId }
          : {}),
      };

      testLogger.error({
        msg: 'delete.provider_not_found_or_unsupported',
        provider: 'UNKNOWN',
        ...jobMeta,
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.msg).toBe('delete.provider_not_found_or_unsupported');
      expect(parsed.correlationId).toBe('corr-delete-789');
      expect(parsed.publicationId).toBe('pub-delete-123');
    });

    it('correctly handles backward compatibility for legacy jobs without correlationId', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const options = buildWorkerPinoOptions({ level: 'info' });
      const testLogger = pino(options, stream);

      // Legacy job payload has no correlationId
      const legacyPublishJob: PublishJobData = {
        publicationId: 'pub-1',
        workspaceId: 'ws-1',
        dispatchVersion: 1,
      };

      expect(legacyPublishJob.correlationId).toBeUndefined();

      const jobMeta = {
        jobId: 'job-legacy-publish-1',
        publicationId: legacyPublishJob.publicationId,
        workspaceId: legacyPublishJob.workspaceId,
        dispatchVersion: legacyPublishJob.dispatchVersion,
        ...(legacyPublishJob.correlationId
          ? { correlationId: legacyPublishJob.correlationId }
          : {}),
      };

      testLogger.info(
        {
          msg: 'publication.succeeded',
          ...jobMeta,
        },
        'Publication succeeded',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.publicationId).toBe('pub-1');
      expect(parsed.workspaceId).toBe('ws-1');
      expect(parsed.dispatchVersion).toBe(1);
      expect(parsed.correlationId).toBeUndefined();
    });
  });
});
