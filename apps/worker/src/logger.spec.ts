import pino from 'pino';
import {
  getWorkerLogLevel,
  buildWorkerPinoOptions,
  WORKER_REDACT_PATHS,
  SENSITIVE_FIELDS,
} from './logger.config';
import { SyncJobData } from './sync/sync.types';
import { PublishJobData } from './publishing/publishing.types';

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

  describe('Secret Redaction', () => {
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
            refreshToken: 'nested-secret-refresh',
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
      expect(parsed.data.refreshToken).toBe('[REDACTED]');
      expect(parsed.data.credentials).toBe('[REDACTED]');
      expect(parsed.job.data.code).toBe('[REDACTED]');
      expect(parsed.job.data.state).toBe('[REDACTED]');
      expect(parsed.encryptedTokens).toBe('[REDACTED]');
    });

    it('redacts sensitive fields on error objects without leaking credentials', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const options = buildWorkerPinoOptions({ level: 'info' });
      const testLogger = pino(options, stream);

      const error: any = new Error('OAuth token expired');
      error.accessToken = 'raw-access-token';
      error.refreshToken = 'raw-refresh-token';
      error.credentials = { password: 'raw-password' };

      testLogger.error({ err: error, jobId: 'sync-failed-1' }, 'Sync failed');

      const parsed = JSON.parse(output.trim());
      expect(parsed.err.message).toBe('OAuth token expired');
      expect(parsed.err.accessToken).toBe('[REDACTED]');
      expect(parsed.err.refreshToken).toBe('[REDACTED]');
      expect(parsed.err.credentials).toBe('[REDACTED]');
    });
  });

  describe('Correlation ID & Backward Compatibility', () => {
    it('correctly handles jobs with a correlationId', () => {
      let output = '';
      const stream = {
        write: (str: string) => {
          output += str;
        },
      };

      const options = buildWorkerPinoOptions({ level: 'info' });
      const testLogger = pino(options, stream);

      const syncJob: SyncJobData = {
        socialAccountId: 'acc-1',
        workspaceId: 'ws-1',
        correlationId: 'corr-api-originated-789',
      };

      testLogger.info(
        {
          jobId: 'job-sync-1',
          socialAccountId: syncJob.socialAccountId,
          workspaceId: syncJob.workspaceId,
          ...(syncJob.correlationId
            ? { correlationId: syncJob.correlationId }
            : {}),
          action: 'sync_job_started',
        },
        'Processing sync job',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.correlationId).toBe('corr-api-originated-789');
      expect(parsed.socialAccountId).toBe('acc-1');
      expect(parsed.workspaceId).toBe('ws-1');
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

      testLogger.info(
        {
          jobId: 'job-legacy-publish-1',
          publicationId: legacyPublishJob.publicationId,
          workspaceId: legacyPublishJob.workspaceId,
          dispatchVersion: legacyPublishJob.dispatchVersion,
          ...(legacyPublishJob.correlationId
            ? { correlationId: legacyPublishJob.correlationId }
            : {}),
          action: 'publication.job.started',
        },
        'Publication job started',
      );

      const parsed = JSON.parse(output.trim());
      expect(parsed.publicationId).toBe('pub-1');
      expect(parsed.workspaceId).toBe('ws-1');
      expect(parsed.dispatchVersion).toBe(1);
      // correlationId is cleanly omitted, not undefined or null string
      expect(parsed.correlationId).toBeUndefined();
    });
  });
});
