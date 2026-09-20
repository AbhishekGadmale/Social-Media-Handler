import codecs

path = 'packages/shared/src/publishing/execution-metadata.ts'
with codecs.open(path, 'r', 'utf-8') as f:
    text = f.read()

orig_base = '''const BaseExecutionMetadataSchema = z.object({
  version: z.literal(1),
  operationId: z.string().uuid(),
  provider: SupportedProviderSchema,
  containerId: z.string().optional(),
  containerCreatedAt: z.string().datetime().optional(),
  publishRequestedAt: z.string().datetime().optional(),
});'''

new_base = '''const BaseExecutionMetadataSchema = z.object({
  version: z.literal(1),
  operationId: z.string().uuid(),
  provider: SupportedProviderSchema,
  containerId: z.string().optional(),
  containerCreatedAt: z.string().datetime().optional(),
  publishRequestedAt: z.string().datetime().optional(),
  lastCheckedAt: z.string().datetime().optional(),
  nextCheckAt: z.string().datetime().optional(),
});'''

text = text.replace(orig_base, new_base)
with codecs.open(path, 'w', 'utf-8') as f:
    f.write(text)
