import codecs

path = 'packages/database/src/publishing/__tests__/remote-execution.spec.ts'
with codecs.open(path, 'r', 'utf-8') as f:
    text = f.read()

text = text.replace(
    "function parseMeta(variant: PostPlatformVariant): ExecutionMetadata { const p = safeParseExecutionMetadata(variant.executionMetadata); if(!p.success) throw new Error('parse'); return p.data; }",
    "function parseMeta(variant: PostPlatformVariant): ExecutionMetadata { const p = safeParseExecutionMetadata(variant.executionMetadata); if(!p.success) { console.error(JSON.stringify(p.error.errors)); throw new Error('parse'); } return p.data; }"
)

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(text)
