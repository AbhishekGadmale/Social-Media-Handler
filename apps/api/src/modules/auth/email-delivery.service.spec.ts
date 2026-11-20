import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  MockEmailDeliveryService,
  NoopEmailDeliveryService,
  ResendEmailDeliveryService,
} from './email-delivery.service';

describe('EmailDeliveryService (Safety & Environment Controls)', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalEmailFrom = process.env.EMAIL_FROM;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalResendKey !== undefined) {
      process.env.RESEND_API_KEY = originalResendKey;
    } else {
      delete process.env.RESEND_API_KEY;
    }
    if (originalEmailFrom !== undefined) {
      process.env.EMAIL_FROM = originalEmailFrom;
    } else {
      delete process.env.EMAIL_FROM;
    }
    if (originalFrontendUrl !== undefined) {
      process.env.FRONTEND_URL = originalFrontendUrl;
    } else {
      delete process.env.FRONTEND_URL;
    }
    vi.restoreAllMocks();
  });

  describe('MockEmailDeliveryService', () => {
    it('Scenario 15: throws an error immediately if invoked in production environment', async () => {
      process.env.NODE_ENV = 'production';
      const service = new MockEmailDeliveryService();

      await expect(
        service.sendVerificationEmail(
          'victim@example.com',
          'raw-secret-token-32-bytes',
        ),
      ).rejects.toThrow(
        'MockEmailDeliveryService must NEVER be used in production.',
      );

      expect(service.sentEmails).toHaveLength(0);
    });

    it('records simulated email in memory during test/development', async () => {
      process.env.NODE_ENV = 'test';
      const service = new MockEmailDeliveryService();

      await service.sendVerificationEmail('test@example.com', 'raw-test-token');

      expect(service.sentEmails).toHaveLength(1);
      expect(service.sentEmails[0]).toEqual({
        toEmail: 'test@example.com',
        rawToken: 'raw-test-token',
      });
    });

    it('Scenario 16: throws error if sendPasswordResetEmail is called in production', async () => {
      process.env.NODE_ENV = 'production';
      const service = new MockEmailDeliveryService();

      await expect(
        service.sendPasswordResetEmail('victim@example.com', 'raw-reset-token'),
      ).rejects.toThrow(
        'MockEmailDeliveryService must NEVER be used in production.',
      );

      expect(service.sentPasswordResetEmails).toHaveLength(0);
    });

    it('records simulated password reset email in memory during test/development', async () => {
      process.env.NODE_ENV = 'test';
      const service = new MockEmailDeliveryService();

      await service.sendPasswordResetEmail(
        'test@example.com',
        'raw-reset-token',
      );

      expect(service.sentPasswordResetEmails).toHaveLength(1);
      expect(service.sentPasswordResetEmails[0]).toEqual({
        toEmail: 'test@example.com',
        rawToken: 'raw-reset-token',
      });
    });

    it('records simulated duplicate signup email in memory during test/development', async () => {
      process.env.NODE_ENV = 'test';
      const service = new MockEmailDeliveryService();

      await service.sendDuplicateSignupEmail('dup@example.com');

      expect(service.sentDuplicateSignupEmails).toHaveLength(1);
      expect(service.sentDuplicateSignupEmails[0]).toEqual({
        toEmail: 'dup@example.com',
      });
    });

    it('records simulated account locked email in memory during test/development', async () => {
      process.env.NODE_ENV = 'test';
      const service = new MockEmailDeliveryService();

      await service.sendAccountLockedEmail('locked@example.com');

      expect(service.sentAccountLockedEmails).toHaveLength(1);
      expect(service.sentAccountLockedEmails[0]).toEqual({
        toEmail: 'locked@example.com',
      });
    });

    it('records simulated approval requested email in memory during test/development', async () => {
      process.env.NODE_ENV = 'test';
      const service = new MockEmailDeliveryService();

      await service.sendApprovalRequestedEmail(
        'approver@example.com',
        'Post content preview...',
      );

      expect(service.sentApprovalRequestedEmails).toHaveLength(1);
      expect(service.sentApprovalRequestedEmails[0]).toEqual({
        toEmail: 'approver@example.com',
        contentPreview: 'Post content preview...',
      });
    });

    it('records simulated approval decision email in memory during test/development', async () => {
      process.env.NODE_ENV = 'test';
      const service = new MockEmailDeliveryService();

      await service.sendApprovalDecisionEmail(
        'author@example.com',
        'Post content preview...',
        'APPROVED',
      );
      await service.sendApprovalDecisionEmail(
        'author@example.com',
        'Post content preview...',
        'CHANGES_REQUESTED',
        'Please fix the tone.',
      );

      expect(service.sentApprovalDecisionEmails).toHaveLength(2);
      expect(service.sentApprovalDecisionEmails[0]).toEqual({
        toEmail: 'author@example.com',
        contentPreview: 'Post content preview...',
        decision: 'APPROVED',
        comment: undefined,
      });
      expect(service.sentApprovalDecisionEmails[1]).toEqual({
        toEmail: 'author@example.com',
        contentPreview: 'Post content preview...',
        decision: 'CHANGES_REQUESTED',
        comment: 'Please fix the tone.',
      });
    });

    it('throws error if sendApprovalRequestedEmail is called in production', async () => {
      process.env.NODE_ENV = 'production';
      const service = new MockEmailDeliveryService();

      await expect(
        service.sendApprovalRequestedEmail('victim@example.com', 'preview'),
      ).rejects.toThrow(
        'MockEmailDeliveryService must NEVER be used in production.',
      );

      expect(service.sentApprovalRequestedEmails).toHaveLength(0);
    });

    it('throws error if sendApprovalDecisionEmail is called in production', async () => {
      process.env.NODE_ENV = 'production';
      const service = new MockEmailDeliveryService();

      await expect(
        service.sendApprovalDecisionEmail(
          'victim@example.com',
          'preview',
          'APPROVED',
        ),
      ).rejects.toThrow(
        'MockEmailDeliveryService must NEVER be used in production.',
      );

      expect(service.sentApprovalDecisionEmails).toHaveLength(0);
    });

    it('throws error if sendWorkspaceInvitationEmail is called in production', async () => {
      process.env.NODE_ENV = 'production';
      const service = new MockEmailDeliveryService();

      await expect(
        service.sendWorkspaceInvitationEmail('victim@example.com', {
          workspaceName: 'Acme Agency',
          role: 'Editor',
          rawToken: 'token123',
        }),
      ).rejects.toThrow(
        'MockEmailDeliveryService must NEVER be used in production.',
      );

      expect(service.sentWorkspaceInvitationEmails).toHaveLength(0);
    });

    it('records simulated workspace invitation email in memory during test/development', async () => {
      process.env.NODE_ENV = 'test';
      const service = new MockEmailDeliveryService();

      await service.sendWorkspaceInvitationEmail('invitee@example.com', {
        workspaceName: 'Acme Agency',
        role: 'Editor',
        rawToken: 'token123',
      });

      expect(service.sentWorkspaceInvitationEmails).toHaveLength(1);
      expect(service.sentWorkspaceInvitationEmails[0]).toEqual({
        toEmail: 'invitee@example.com',
        details: {
          workspaceName: 'Acme Agency',
          role: 'Editor',
          rawToken: 'token123',
        },
      });
    });
  });

  describe('NoopEmailDeliveryService', () => {
    it('executes safely without side effects in any environment', async () => {
      process.env.NODE_ENV = 'production';
      const service = new NoopEmailDeliveryService();

      await expect(
        service.sendVerificationEmail('prod@example.com', 'raw-token'),
      ).resolves.toBeUndefined();
      await expect(
        service.sendPasswordResetEmail('prod@example.com', 'raw-token'),
      ).resolves.toBeUndefined();
      await expect(
        service.sendDuplicateSignupEmail('prod@example.com'),
      ).resolves.toBeUndefined();
      await expect(
        service.sendAccountLockedEmail('prod@example.com'),
      ).resolves.toBeUndefined();
      await expect(
        service.sendApprovalRequestedEmail('prod@example.com', 'preview'),
      ).resolves.toBeUndefined();
      await expect(
        service.sendApprovalDecisionEmail(
          'prod@example.com',
          'preview',
          'APPROVED',
        ),
      ).resolves.toBeUndefined();
      await expect(
        service.sendWorkspaceInvitationEmail('prod@example.com', {
          workspaceName: 'Acme',
          role: 'Editor',
          rawToken: 'token',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('ResendEmailDeliveryService', () => {
    it('throws an error if RESEND_API_KEY is not configured', async () => {
      delete process.env.RESEND_API_KEY;
      const service = new ResendEmailDeliveryService();

      await expect(
        service.sendVerificationEmail('user@example.com', 'raw-token-123'),
      ).rejects.toThrow('Resend API key is not configured');
    });

    it('successfully sends email via Resend API', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';
      process.env.EMAIL_FROM = 'Test App <auth@example.com>';
      process.env.FRONTEND_URL = 'https://app.example.com';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'email-resend-id' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await service.sendVerificationEmail(
        'alice@example.com',
        'raw-test-token-value',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        Authorization: 'Bearer mock-resend-api-key-test',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(options.body);
      expect(body.from).toBe('Test App <auth@example.com>');
      expect(body.to).toEqual(['alice@example.com']);
      expect(body.subject).toBe('Verify your Agency OS account');
      expect(body.html).toContain(
        'https://app.example.com/verify-email?token=raw-test-token-value',
      );
      expect(body.text).toContain(
        'https://app.example.com/verify-email?token=raw-test-token-value',
      );
    });

    it('throws an error when Resend API returns non-2xx', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Domain not verified',
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await expect(
        service.sendVerificationEmail('bob@example.com', 'raw-token'),
      ).rejects.toThrow('Failed to send verification email via Resend (403)');
      await expect(
        service.sendPasswordResetEmail('bob@example.com', 'raw-token'),
      ).rejects.toThrow('Failed to send password reset email via Resend (403)');
    });

    it('successfully sends password reset email via Resend API', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';
      process.env.EMAIL_FROM = 'Test App <auth@example.com>';
      process.env.FRONTEND_URL = 'https://app.example.com';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'email-resend-reset-id' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await service.sendPasswordResetEmail(
        'alice@example.com',
        'raw-reset-token-value',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        Authorization: 'Bearer mock-resend-api-key-test',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(options.body);
      expect(body.from).toBe('Test App <auth@example.com>');
      expect(body.to).toEqual(['alice@example.com']);
      expect(body.subject).toBe('Reset your Agency OS password');
      expect(body.html).toContain(
        'https://app.example.com/reset-password?token=raw-reset-token-value',
      );
      expect(body.text).toContain(
        'https://app.example.com/reset-password?token=raw-reset-token-value',
      );
    });

    it('successfully sends duplicate signup notification email via Resend API with exact subject and copy', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';
      process.env.EMAIL_FROM = 'Test App <auth@example.com>';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'email-resend-dup-id' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await service.sendDuplicateSignupEmail('alice@example.com');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        Authorization: 'Bearer mock-resend-api-key-test',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(options.body);
      expect(body.from).toBe('Test App <auth@example.com>');
      expect(body.to).toEqual(['alice@example.com']);
      expect(body.subject).toBe(
        'An Agency OS account already exists for this email',
      );
      expect(body.text).toContain(
        'Someone attempted to create an Agency OS account with this email address. If this was you, please sign in or reset your password. If this was not you, no action is needed — your account remains secure and no new account was created.',
      );
      expect(body.html).toContain(
        'Someone attempted to create an Agency OS account with this email address. If this was you, please sign in or reset your password. If this was not you, no action is needed — your account remains secure and no new account was created.',
      );
    });

    it('successfully sends account locked notification email via Resend API with exact subject and copy', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';
      process.env.EMAIL_FROM = 'Test App <auth@example.com>';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'email-resend-locked-id' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await service.sendAccountLockedEmail('alice@example.com');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        Authorization: 'Bearer mock-resend-api-key-test',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(options.body);
      expect(body.from).toBe('Test App <auth@example.com>');
      expect(body.to).toEqual(['alice@example.com']);
      expect(body.subject).toBe(
        'Your Agency OS account was temporarily locked',
      );
      expect(body.text).toContain(
        'Multiple failed login attempts detected on your account. For your security, your account has been temporarily locked for 15 minutes. If this was you, wait 15 minutes and try again, or reset your password. If this was not you, we recommend resetting your password after the lock expires.',
      );
      expect(body.html).toContain(
        'Multiple failed login attempts detected on your account. For your security, your account has been temporarily locked for 15 minutes. If this was you, wait 15 minutes and try again, or reset your password. If this was not you, we recommend resetting your password after the lock expires.',
      );
    });

    it('successfully sends approval requested email via Resend API', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';
      process.env.EMAIL_FROM = 'Test App <auth@example.com>';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'email-resend-approval-req-id' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await service.sendApprovalRequestedEmail(
        'reviewer@example.com',
        'Check out our latest update!',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.from).toBe('Test App <auth@example.com>');
      expect(body.to).toEqual(['reviewer@example.com']);
      expect(body.subject).toBe(
        'A post is waiting for your approval in Agency OS',
      );
      expect(body.text).toContain('Check out our latest update!');
      expect(body.html).toContain('Check out our latest update!');
    });

    it('successfully sends approval decision email (APPROVED) via Resend API', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';
      process.env.EMAIL_FROM = 'Test App <auth@example.com>';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'email-resend-approved-id' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await service.sendApprovalDecisionEmail(
        'author@example.com',
        'Great post content',
        'APPROVED',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.to).toEqual(['author@example.com']);
      expect(body.subject).toBe('Your post was approved in Agency OS');
      expect(body.text).toContain('Great post content');
    });

    it('successfully sends approval decision email (CHANGES_REQUESTED) via Resend API with comment', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';
      process.env.EMAIL_FROM = 'Test App <auth@example.com>';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'email-resend-changes-id' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await service.sendApprovalDecisionEmail(
        'author@example.com',
        'Draft content',
        'CHANGES_REQUESTED',
        'Please replace image with higher resolution',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.to).toEqual(['author@example.com']);
      expect(body.subject).toBe(
        'Changes were requested on your post in Agency OS',
      );
      expect(body.text).toContain('Draft content');
      expect(body.text).toContain(
        'Please replace image with higher resolution',
      );
      expect(body.html).toContain(
        'Please replace image with higher resolution',
      );
    });

    it('successfully sends workspace invitation email via Resend API', async () => {
      process.env.RESEND_API_KEY = 'mock-resend-api-key-test';
      process.env.EMAIL_FROM = 'Test App <auth@example.com>';
      process.env.FRONTEND_URL = 'https://app.example.com';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'email-resend-invite-id' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ResendEmailDeliveryService();
      await service.sendWorkspaceInvitationEmail('newmember@example.com', {
        workspaceName: 'Rocket Agency',
        role: 'Client Approver',
        rawToken: 'raw-invite-token-xyz',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.to).toEqual(['newmember@example.com']);
      expect(body.subject).toBe(
        "You've been invited to join Rocket Agency on Agency OS",
      );
      expect(body.text).toContain('Rocket Agency');
      expect(body.text).toContain('Client Approver');
      expect(body.text).toContain(
        'https://app.example.com/accept-invite?token=raw-invite-token-xyz',
      );
      expect(body.html).toContain(
        'https://app.example.com/accept-invite?token=raw-invite-token-xyz',
      );
    });
  });
});
