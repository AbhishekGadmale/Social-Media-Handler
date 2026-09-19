import { z } from 'zod';

export const ExecutionPhaseSchema = z.enum([
  'INITIATED',
  'CONTAINER_CREATED',
  'PROCESSING_REMOTE',
  'PUBLISH_REQUESTED',
  'COMPLETED',
  'FAILED',
  'AMBIGUOUS',
]);

export type ExecutionPhase = z.infer<typeof ExecutionPhaseSchema>;

export const SupportedProviderSchema = z.enum([
  'FACEBOOK',
  'INSTAGRAM',
  'LINKEDIN',
  'TWITTER',
  'TIKTOK',
  'YOUTUBE',
]);

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

/**
 * Validates and parses execution metadata safely.
 * Rejects invalid, unknown versions, or malformed JSON.
 */
export function parseExecutionMetadata(value: unknown): ExecutionMetadata {
  return ExecutionMetadataSchema.parse(value);
}

/**
 * Safely validates and parses execution metadata.
 * Returns a SafeParseReturnType which handles failures without throwing.
 */
export function safeParseExecutionMetadata(value: unknown) {
  return ExecutionMetadataSchema.safeParse(value);
}
