import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublishingApplicationService } from './services/publishing-application.service';
import { NotFoundException } from '@nestjs/common';
import { ApprovalStatus, PostStatus } from '@agency-os/database';

describe('PublishingApplicationService Client Scoping', () => {
  let service: PublishingApplicationService;
  let mockPrisma: any;
  let mockRepo: any;
  let mockAudit: any;
  let mockEmailDelivery: any;
  let mockValidator: any;

  beforeEach(() => {
    mockRepo = {
      posts: {
        findMany: vi.fn(),
        findById: vi.fn(),
        update: vi.fn(),
      },
    };

    mockPrisma = {
      postPlatformVariant: {
        findFirst: vi.fn(),
      },
      workspaceMember: {
        findMany: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
    };

    mockAudit = {
      logAction: vi.fn().mockResolvedValue(undefined),
    };

    mockEmailDelivery = {
      sendApprovalRequestedEmail: vi.fn().mockResolvedValue(undefined),
      sendApprovalDecisionEmail: vi.fn().mockResolvedValue(undefined),
    };

    mockValidator = {
      validateTarget: vi.fn(),
    };

    service = new PublishingApplicationService(
      mockPrisma,
      mockAudit,
      mockValidator,
      mockEmailDelivery,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    );

    // Mock getRepo internal method
    (service as any).getRepo = vi.fn().mockReturnValue(mockRepo);
  });

  describe('getPosts scoping', () => {
    it('applies variant socialAccount clientId filter when scopeClientId is provided', async () => {
      mockRepo.posts.findMany.mockResolvedValue([]);

      await service.getPosts('ws-1', 50, 0, 'client-1');

      expect(mockRepo.posts.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            variants: {
              some: {
                socialAccount: {
                  clientId: 'client-1',
                },
              },
            },
          },
        }),
      );
    });

    it('does not apply variant filter when scopeClientId is omitted', async () => {
      mockRepo.posts.findMany.mockResolvedValue([]);

      await service.getPosts('ws-1', 50, 0);

      expect(mockRepo.posts.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: undefined,
        }),
      );
    });
  });

  describe('getPostById scoping', () => {
    it('returns post if at least one variant targets scopeClientId', async () => {
      mockRepo.posts.findById.mockResolvedValue({
        id: 'p1',
        variants: [
          { socialAccount: { clientId: 'client-1' } },
          { socialAccount: { clientId: 'client-2' } },
        ],
      });

      const res = await service.getPostById('ws-1', 'p1', 'client-1');
      expect(res.id).toBe('p1');
    });

    it('throws 404 NotFoundException if no variant targets scopeClientId', async () => {
      mockRepo.posts.findById.mockResolvedValue({
        id: 'p1',
        variants: [{ socialAccount: { clientId: 'client-2' } }],
      });

      await expect(
        service.getPostById('ws-1', 'p1', 'client-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 NotFoundException if draft has no variants for scoped approver', async () => {
      mockRepo.posts.findById.mockResolvedValue({
        id: 'p1',
        variants: [],
      });

      await expect(
        service.getPostById('ws-1', 'p1', 'client-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('approvePost & requestChanges scoping', () => {
    it('throws 404 if post is out of scope on approvePost', async () => {
      mockRepo.posts.findById.mockResolvedValue({
        id: 'p1',
        approvalStatus: ApprovalStatus.PENDING,
        variants: [{ socialAccount: { clientId: 'client-2' } }],
      });

      await expect(
        service.approvePost('ws-1', 'u-1', 'p1', 'client-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 if post is out of scope on requestChanges', async () => {
      mockRepo.posts.findById.mockResolvedValue({
        id: 'p1',
        approvalStatus: ApprovalStatus.PENDING,
        variants: [{ socialAccount: { clientId: 'client-2' } }],
      });

      await expect(
        service.requestChanges(
          'ws-1',
          'u-1',
          'p1',
          'changes please',
          'client-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateTarget scoping', () => {
    it('throws 404 NotFoundException if variant socialAccount clientId does not match scopeClientId', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: 'v1',
        workspaceId: 'ws-1',
        socialAccount: { clientId: 'client-2' },
      });

      await expect(
        service.validateTarget('ws-1', 'v1', false, 'client-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('proceeds with validation if variant socialAccount clientId matches scopeClientId', async () => {
      mockPrisma.postPlatformVariant.findFirst.mockResolvedValue({
        id: 'v1',
        workspaceId: 'ws-1',
        socialAccount: { clientId: 'client-1' },
      });
      mockValidator.validateTarget.mockResolvedValue({
        valid: true,
        issues: [],
      });

      const res = await service.validateTarget('ws-1', 'v1', false, 'client-1');
      expect(res.valid).toBe(true);
    });
  });

  describe('requestApproval email dispatch scoping', () => {
    it('sends email to scoped approver only if post targets their client', async () => {
      const postWithVariants = {
        id: 'p1',
        authorId: 'author-1',
        status: PostStatus.DRAFT,
        approvalStatus: ApprovalStatus.NOT_SUBMITTED,
        content: 'Check out client 1 updates',
        variants: [
          {
            status: PostStatus.DRAFT,
            socialAccount: { clientId: 'client-1' },
          },
        ],
      };

      mockRepo.posts.findById.mockResolvedValue(postWithVariants);
      mockRepo.posts.update.mockResolvedValue({
        ...postWithVariants,
        approvalStatus: ApprovalStatus.PENDING,
      });

      // Two approvers: one scoped to client-1, one scoped to client-2, one unscoped manager
      mockPrisma.workspaceMember.findMany.mockResolvedValue([
        {
          id: 'm1',
          role: 'CLIENT_APPROVER',
          clientId: 'client-1',
          user: { email: 'approver1@client1.com' },
        },
        {
          id: 'm2',
          role: 'CLIENT_APPROVER',
          clientId: 'client-2',
          user: { email: 'approver2@client2.com' },
        },
        {
          id: 'm3',
          role: 'MANAGER',
          clientId: null,
          user: { email: 'manager@agency.com' },
        },
      ]);

      await service.requestApproval('ws-1', 'author-1', 'p1');

      // Approver 1 (scoped to client-1) and Manager should receive email.
      // Approver 2 (scoped to client-2) must NOT receive email!
      expect(mockEmailDelivery.sendApprovalRequestedEmail).toHaveBeenCalledWith(
        'approver1@client1.com',
        expect.any(String),
      );
      expect(mockEmailDelivery.sendApprovalRequestedEmail).toHaveBeenCalledWith(
        'manager@agency.com',
        expect.any(String),
      );
      expect(
        mockEmailDelivery.sendApprovalRequestedEmail,
      ).not.toHaveBeenCalledWith('approver2@client2.com', expect.any(String));
    });
  });
});
