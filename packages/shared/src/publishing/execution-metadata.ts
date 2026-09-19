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

export const ExecutionMetadataSchema = z.object({
  version: z.literal(1),
  operationId: z.string().uuid(),
  provider: SupportedProviderSchema,
  phase: ExecutionPhaseSchema,
  containerId: z.string().optional(),
  containerCreatedAt: z.string().datetime().optional(),
  publishRequestedAt: z.string().datetime().optional(),
  finalRemoteId: z.string().optional(),
  lastCheckedAt: z.string().datetime().optional(),
  nextCheckAt: z.string().datetime().optional(),
}).strict();

export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>;

export function safeParseExecutionMetadata(data: unknown) {
  return ExecutionMetadataSchema.safeParse(data);
}
export function parseExecutionMetadata(data: unknown): ExecutionMetadata { return ExecutionMetadataSchema.parse(data); }
