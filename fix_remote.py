import codecs
path = 'packages/database/src/publishing/__tests__/remote-execution.spec.ts'
with codecs.open(path, 'r', 'utf-8') as f: text = f.read()
text = text.replace('expect(typeof (parseMeta(getVariant(res)) as any).publishRequestedAt).toBe(\'string\');', '// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access\n      expect(typeof (parseMeta(getVariant(res)) as any).publishRequestedAt).toBe(\'string\');')
with codecs.open(path, 'w', 'utf-8') as f: f.write(text)
