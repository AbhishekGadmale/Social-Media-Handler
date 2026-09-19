import { PrismaClient, Prisma, PostPlatformVariant } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ExecutionPhase, safeParseExecutionMetadata } from '@agency-os/shared';

export enum ExecutionTransitionResultType {
  SUCCESS = "SUCCESS",
  NOT_FOUND = "NOT_FOUND",
  NO_ACTIVE_OPERATION = "NO_ACTIVE_OPERATION",
  MALFORMED_STATE = "MALFORMED_STATE",
  OPERATION_MISMATCH = "OPERATION_MISMATCH",
  PHASE_MISMATCH = "PHASE_MISMATCH",
  TERMINAL_STATE = "TERMINAL_STATE",
  VERSION_CONFLICT = "VERSION_CONFLICT",
  EXECUTION_STATE_EXISTS = "EXECUTION_STATE_EXISTS",
  ILLEGAL_TRANSITION = "ILLEGAL_TRANSITION",
}

export type ExecutionTransitionResult =
  | {
      type: ExecutionTransitionResultType.SUCCESS;
      variant: PostPlatformVariant;
    }
  | {
      type: Exclude<
        ExecutionTransitionResultType,
        ExecutionTransitionResultType.SUCCESS
      >;
      reason: string;
    };

const TERMINAL_PHASES: ExecutionPhase[] = ["COMPLETED", "FAILED", "AMBIGUOUS"];

const ALLOWED_TRANSITIONS: Record<ExecutionPhase, ExecutionPhase[]> = {
  INITIATED: ["CONTAINER_CREATED", "PUBLISH_REQUESTED", "FAILED"],
  CONTAINER_CREATED: ["PROCESSING_REMOTE", "PUBLISH_REQUESTED", "FAILED"],
  PROCESSING_REMOTE: ["PROCESSING_REMOTE", "PUBLISH_REQUESTED", "FAILED"],
  PUBLISH_REQUESTED: ["COMPLETED", "AMBIGUOUS"],
  COMPLETED: [],
  FAILED: [],
  AMBIGUOUS: [],
};

export class ExecutionMetadataRepository {
  constructor(
    protected prisma: PrismaClient,
    public readonly workspaceId: string,
  ) {}

  /**
   * Starts a new logical operation.
   * Requires that there is no active operation, or the current operation is in a terminal state.
   */
  async startOperation(
    variantId: string,
    provider: "FACEBOOK" | "INSTAGRAM" | "LINKEDIN" | "TWITTER" | "TIKTOK" | "YOUTUBE"
  ): Promise<ExecutionTransitionResult> {
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.postPlatformVariant.findFirst({
        where: { id: variantId, workspaceId: this.workspaceId },
      });

      if (!variant) return { type: ExecutionTransitionResultType.NOT_FOUND, reason: "Variant not found" };

      if (variant.executionMetadata !== null && variant.executionMetadata !== undefined) {
        return {
          type: ExecutionTransitionResultType.EXECUTION_STATE_EXISTS,
          reason: "An execution state already exists. startOperation requires NULL.",
        };
      }

      const operationId = randomUUID();
      const newMetadata = {
        version: 1,
        operationId,
        provider,
        phase: "INITIATED",
      };

      const updated = await tx.postPlatformVariant.updateMany({
        where: { id: variantId, dispatchVersion: variant.dispatchVersion },
        data: {
          executionMetadata: newMetadata,
          dispatchVersion: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        return {
          type: ExecutionTransitionResultType.VERSION_CONFLICT,
          reason: "Dispatch version conflict",
        };
      }

      const finalVariant = await tx.postPlatformVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      return {
        type: ExecutionTransitionResultType.SUCCESS,
        variant: finalVariant,
      };
    });
  }

  /**
   * Transitions an existing operation safely using CAS.
   */
  async transitionOperation(
    variantId: string,
    expectedOperationId: string,
    expectedPhase: ExecutionPhase,
    nextPhase: ExecutionPhase,
    expectedDispatchVersion: number,
    data?: {
      containerId?: string;
      finalRemoteId?: string;
      delayMs?: number;
    },
    clientTx?: Prisma.TransactionClient
  ): Promise<ExecutionTransitionResult> {
    const runTx = async (tx: Prisma.TransactionClient): Promise<ExecutionTransitionResult> => {
      const variant = await tx.postPlatformVariant.findFirst({
        where: { id: variantId, workspaceId: this.workspaceId },
      });

      if (!variant)
        return {
          type: ExecutionTransitionResultType.NOT_FOUND,
          reason: "Variant not found",
        };
      if (variant.dispatchVersion !== expectedDispatchVersion)
        return {
          type: ExecutionTransitionResultType.VERSION_CONFLICT,
          reason: "Dispatch version mismatch before read",
        };
      if (!variant.executionMetadata)
        return {
          type: ExecutionTransitionResultType.NO_ACTIVE_OPERATION,
          reason: "No active execution metadata",
        };

      const parsed = safeParseExecutionMetadata(variant.executionMetadata);
      if (!parsed.success)
        return {
          type: ExecutionTransitionResultType.MALFORMED_STATE,
          reason: "Persisted state is malformed",
        };

      const current = parsed.data;
      if (current.operationId !== expectedOperationId)
        return {
          type: ExecutionTransitionResultType.OPERATION_MISMATCH,
          reason: "Operation ID mismatch",
        };
      if (current.phase !== expectedPhase)
        return {
          type: ExecutionTransitionResultType.PHASE_MISMATCH,
          reason: `Phase mismatch. Expected ${expectedPhase}, got ${current.phase}`,
        };

      if (TERMINAL_PHASES.includes(current.phase)) {
        return {
          type: ExecutionTransitionResultType.TERMINAL_STATE,
          reason: "Cannot transition from a terminal state",
        };
      }

      const allowed = ALLOWED_TRANSITIONS[current.phase] || [];
      if (!allowed.includes(nextPhase)) {
        return {
          type: ExecutionTransitionResultType.ILLEGAL_TRANSITION,
          reason: `Cannot transition from ${current.phase} to ${nextPhase}`,
        };
      }

      // Enforce data constraints
      const nextMetadata: Record<string, unknown> = { ...current, phase: nextPhase };

      if (nextPhase === "CONTAINER_CREATED") {
        if (!data?.containerId)
          return {
            type: ExecutionTransitionResultType.ILLEGAL_TRANSITION,
            reason: "containerId is required for CONTAINER_CREATED",
          };
        nextMetadata.containerId = data.containerId;
        nextMetadata.containerCreatedAt = new Date().toISOString();
      }

      if (nextPhase === "PROCESSING_REMOTE") {
        const MIN_REMOTE_CONTINUATION_DELAY_MS = 15000;
        const MAX_REMOTE_CONTINUATION_DELAY_MS = 86400000;
        if (typeof data?.delayMs !== 'number' || isNaN(data.delayMs) || !isFinite(data.delayMs) || data.delayMs < MIN_REMOTE_CONTINUATION_DELAY_MS || data.delayMs > MAX_REMOTE_CONTINUATION_DELAY_MS)
          return {
            type: ExecutionTransitionResultType.ILLEGAL_TRANSITION,
            reason: "Valid delayMs (15s to 24h) required for PROCESSING_REMOTE",
          };
        const now = Date.now();
        nextMetadata.lastCheckedAt = new Date(now).toISOString();
        nextMetadata.nextCheckAt = new Date(now + data.delayMs).toISOString();
      }

      if (nextPhase === "PUBLISH_REQUESTED") {
        nextMetadata.publishRequestedAt = new Date().toISOString();
      }

      if (nextPhase === "COMPLETED") {
        if (!data?.finalRemoteId)
          return {
            type: ExecutionTransitionResultType.ILLEGAL_TRANSITION,
            reason: "finalRemoteId is required for COMPLETED",
          };
        nextMetadata.finalRemoteId = data.finalRemoteId;
      }

      const updated = await tx.postPlatformVariant.updateMany({
        where: { id: variantId, dispatchVersion: expectedDispatchVersion },
        data: {
          executionMetadata: nextMetadata as Prisma.InputJsonValue,
          dispatchVersion: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        return {
          type: ExecutionTransitionResultType.VERSION_CONFLICT,
          reason: "Dispatch version conflict during write",
        };
      }

      const finalVariant = await tx.postPlatformVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      return {
        type: ExecutionTransitionResultType.SUCCESS,
        variant: finalVariant,
      };
    };
    
    if (clientTx) {
      return runTx(clientTx);
    } else {
      return this.prisma.$transaction(runTx);
    }
  }
}
