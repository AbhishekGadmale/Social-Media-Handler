import codecs

path = 'packages/database/src/publishing/__tests__/remote-execution.spec.ts'
with codecs.open(path, 'r', 'utf-8') as f:
    text = f.read()

text = text.replace('describe(\'Real PostgreSQL Integration Tests', '/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion, no-empty, @typescript-eslint/no-unused-vars */\n  describe(\'Real PostgreSQL Integration Tests')

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(text)
