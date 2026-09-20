import codecs

path = 'apps/worker/src/publishing/bullmq_proof.spec.ts'
with codecs.open(path, 'r', 'utf-8') as f:
    text = f.read()

text = text.replace("externalId: 'ext'", "externalId: generateId()")
text = text.replace("data: { status: 'QUEUED' }", "data: { status: 'QUEUED', executionMetadata: {} as any }")

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(text)
