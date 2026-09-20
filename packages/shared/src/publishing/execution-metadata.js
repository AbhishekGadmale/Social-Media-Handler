"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionMetadataSchema = exports.ExecutionPhaseSchema = exports.SupportedProviderSchema = void 0;
exports.safeParseExecutionMetadata = safeParseExecutionMetadata;
exports.parseExecutionMetadata = parseExecutionMetadata;
var zod_1 = require("zod");
exports.SupportedProviderSchema = zod_1.z.enum([
    'FACEBOOK',
    'INSTAGRAM',
    'LINKEDIN',
    'TWITTER',
    'TIKTOK',
    'YOUTUBE'
]);
exports.ExecutionPhaseSchema = zod_1.z.enum([
    'INITIATED',
    'CONTAINER_CREATED',
    'PROCESSING_REMOTE',
    'PUBLISH_REQUESTED',
    'COMPLETED',
    'FAILED',
    'AMBIGUOUS'
]);
var BaseExecutionMetadataSchema = zod_1.z.object({
    version: zod_1.z.literal(1),
    operationId: zod_1.z.string().uuid(),
    provider: exports.SupportedProviderSchema,
    containerId: zod_1.z.string().optional(),
    containerCreatedAt: zod_1.z.string().datetime().optional(),
    publishRequestedAt: zod_1.z.string().datetime().optional(),
    lastCheckedAt: zod_1.z.string().datetime().optional(),
    nextCheckAt: zod_1.z.string().datetime().optional(),
});
exports.ExecutionMetadataSchema = zod_1.z.discriminatedUnion('phase', [
    BaseExecutionMetadataSchema.extend({ phase: zod_1.z.literal('INITIATED') }).strict(),
    BaseExecutionMetadataSchema.extend({ phase: zod_1.z.literal('FAILED') }).strict(),
    BaseExecutionMetadataSchema.extend({ phase: zod_1.z.literal('AMBIGUOUS') }).strict(),
    BaseExecutionMetadataSchema.extend({
        phase: zod_1.z.literal('CONTAINER_CREATED'),
        containerId: zod_1.z.string(),
        containerCreatedAt: zod_1.z.string().datetime(),
    }).strict(),
    BaseExecutionMetadataSchema.extend({
        phase: zod_1.z.literal('PROCESSING_REMOTE'),
        lastCheckedAt: zod_1.z.string().datetime(),
        nextCheckAt: zod_1.z.string().datetime(),
    }).strict(),
    BaseExecutionMetadataSchema.extend({
        phase: zod_1.z.literal('PUBLISH_REQUESTED'),
        publishRequestedAt: zod_1.z.string().datetime(),
    }).strict(),
    BaseExecutionMetadataSchema.extend({
        phase: zod_1.z.literal('COMPLETED'),
        finalRemoteId: zod_1.z.string(),
    }).strict(),
]);
function safeParseExecutionMetadata(data) {
    return exports.ExecutionMetadataSchema.safeParse(data);
}
function parseExecutionMetadata(data) { return exports.ExecutionMetadataSchema.parse(data); }
