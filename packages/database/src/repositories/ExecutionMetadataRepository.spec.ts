import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ExecutionPhase } from "@agency-os/shared";
import {
  ExecutionMetadataRepository,
  ExecutionTransitionResultType,
} from "./ExecutionMetadataRepository";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

describe("ExecutionMetadataRepository - State Graph Transitions", () => {
  let repo: ExecutionMetadataRepository;
  let workspaceId: string;
  let socialAccountId: string;
  let orgId: string;

  beforeAll(async () => {
    repo = new ExecutionMetadataRepository(prisma, workspaceId);
    workspaceId = randomUUID();
    socialAccountId = randomUUID();
    orgId = randomUUID();

    await prisma.organization.create({
      data: { id: orgId, name: "Test Org" },
    });
    await prisma.workspace.create({
      data: { id: workspaceId, name: "Test WS", organizationId: orgId },
    });
    await prisma.socialAccount.create({
      data: {
        id: socialAccountId,
        workspaceId,
        provider: "YOUTUBE",
        externalId: randomUUID(),
        name: "Test Account",
        status: "ACTIVE",
      },
    });
  });

  afterAll(async () => {
    await prisma.postPlatformVariant.deleteMany({ where: { workspaceId } });
    await prisma.post.deleteMany({ where: { workspaceId } });
    await prisma.socialAccount.deleteMany({ where: { id: socialAccountId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  async function createVariantWithPhase(phase: ExecutionPhase): Promise<{ publicationId: string; operationId: string; dispatchVersion: number }> {
    const publicationId = randomUUID();
    const postId = randomUUID();
    await prisma.post.create({ data: { id: postId, workspaceId, content: "test", status: "DRAFT" } });
    const operationId = randomUUID();
    await prisma.postPlatformVariant.create({
      data: {
        id: publicationId,
        post: { connect: { id: postId } },
        socialAccount: { connect: { id: socialAccountId } },
        workspace: { connect: { id: workspaceId } },
        status: "PUBLISHING",
        dispatchVersion: 1,
        executionMetadata: {
          version: 1,
          operationId,
          provider: "YOUTUBE",
          phase,
          ...(phase === 'CONTAINER_CREATED' ? { containerId: 'c123', containerCreatedAt: new Date().toISOString() } : {}),
          ...(phase === 'PROCESSING_REMOTE' ? { lastCheckedAt: new Date().toISOString(), nextCheckAt: new Date().toISOString() } : {}),
          ...(phase === 'PUBLISH_REQUESTED' ? { publishRequestedAt: new Date().toISOString() } : {}),
          ...(phase === 'COMPLETED' ? { finalRemoteId: 'vid-123' } : {})
        },
      },
    });
    return { publicationId, operationId, dispatchVersion: 1 };
  }

  it("A. INITIATED -> PROCESSING_REMOTE => ILLEGAL_TRANSITION", async () => {
    const { publicationId, operationId, dispatchVersion } = await createVariantWithPhase("INITIATED");
    const res = await repo.transitionOperation(publicationId, operationId, "INITIATED", "PROCESSING_REMOTE", dispatchVersion, { delayMs: 60000 });
    expect(res.type).toBe(ExecutionTransitionResultType.ILLEGAL_TRANSITION);
  });

  it("B. PUBLISH_REQUESTED -> PROCESSING_REMOTE => SUCCESS", async () => {
    const { publicationId, operationId, dispatchVersion } = await createVariantWithPhase("PUBLISH_REQUESTED");
    const res = await repo.transitionOperation(publicationId, operationId, "PUBLISH_REQUESTED", "PROCESSING_REMOTE", dispatchVersion, { delayMs: 60000 });
    expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
  });

  it("C. CONTAINER_CREATED -> PROCESSING_REMOTE => SUCCESS", async () => {
    const { publicationId, operationId, dispatchVersion } = await createVariantWithPhase("CONTAINER_CREATED");
    const res = await repo.transitionOperation(publicationId, operationId, "CONTAINER_CREATED", "PROCESSING_REMOTE", dispatchVersion, { delayMs: 60000 });
    expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
  });

  it("D. PROCESSING_REMOTE -> PROCESSING_REMOTE => SUCCESS", async () => {
    const { publicationId, operationId, dispatchVersion } = await createVariantWithPhase("PROCESSING_REMOTE");
    const res = await repo.transitionOperation(publicationId, operationId, "PROCESSING_REMOTE", "PROCESSING_REMOTE", dispatchVersion, { delayMs: 60000 });
    expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
  });

  it("E. PROCESSING_REMOTE -> PUBLISH_REQUESTED => SUCCESS", async () => {
    const { publicationId, operationId, dispatchVersion } = await createVariantWithPhase("PROCESSING_REMOTE");
    const res = await repo.transitionOperation(publicationId, operationId, "PROCESSING_REMOTE", "PUBLISH_REQUESTED", dispatchVersion, { delayMs: 60000 });
    expect(res.type).toBe(ExecutionTransitionResultType.SUCCESS);
  });
});
