import codecs

path = 'packages/database/src/repositories/ExecutionMetadataRepository.ts'
with codecs.open(path, 'r', 'utf-8') as f:
    text = f.read()

text = text.replace(
    'INITIATED: ["CONTAINER_CREATED", "FAILED"],',
    'INITIATED: ["CONTAINER_CREATED", "COMPLETED", "FAILED"],'
)

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(text)
