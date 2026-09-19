import { z } from 'zod';

export const SupportedProviderSchema = z.enum([
  'FACEBOOK',
  'INSTAGRAM',
  'LINKEDIN',
  'TWITTER',
  'TIKTOK',
  'YOUTUBE'
]);

export type SupportedProvider = z.infer<typeof SupportedProviderSchema>;

export const ExecutionPhaseSchema = z.enum([
  'INITIATED',
  'CONTAINER_CREATED',
  'PROCESSING_REMOTE',
  'PUBLISH_REQUESTED',
  'COMPLETED',
  'FAILED',
  'AMBIGUOUS'
]);

export type ExecutionPhase = z.infer<typeof ExecutionPhaseSchema>;

const BaseExecutionMetadataSchema = z.object({
  version: z.literal(1),
  operationId: z.string().uuid(),
  provider: SupportedProviderSchema,
  containerId: z.string().optional(),
  containerCreatedAt: z.string().datetime().optional(),
});

export const ExecutionMetadataSchema = z.discriminatedUnion('phase', [
  BaseExecutionMetadataSchema.extend({ phase: z.literal('INITIATED') }),
  BaseExecutionMetadataSchema.extend({ phase: z.literal('FAILED') }),
  BaseExecutionMetadataSchema.extend({ phase: z.literal('AMBIGUOUS') }),
  BaseExecutionMetadataSchema.extend({
    phase: z.literal('CONTAINER_CREATED'),
    containerId: z.string(),
    containerCreatedAt: z.string().datetime(),
  }),
  BaseExecutionMetadataSchema.extend({
    phase: z.literal('PROCESSING_REMOTE'),
    lastCheckedAt: z.string().datetime(),
    nextCheckAt: z.string().datetime(),
  }),
  BaseExecutionMetadataSchema.extend({
    phase: z.literal('PUBLISH_REQUESTED'),
    publishRequestedAt: z.string().datetime(),
  }),
  BaseExecutionMetadataSchema.extend({
    phase: z.literal('COMPLETED'),
    finalRemoteId: z.string(),
  }),
]);

export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>;

export function safeParseExecutionMetadata(data: unknown) {
  return ExecutionMetadataSchema.safeParse(data);
}
export function parseExecutionMetadata(data: unknown): ExecutionMetadata { return ExecutionMetadataSchema.parse(data); }
