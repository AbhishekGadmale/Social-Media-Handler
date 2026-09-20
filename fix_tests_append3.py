import codecs, re

path = 'packages/database/src/publishing/__tests__/remote-execution.spec.ts'
with codecs.open(path, 'r', 'utf-8') as f:
    text = f.read()

# Just find where Real PostgreSQL Integration Tests starts and remove the closing brackets before it
idx = text.find("  describe('Real PostgreSQL Integration Tests'")

if idx != -1:
    before = text[:idx]
    after = text[idx:]
    # remove the closing brackets from 'before'
    before = before.rstrip().rstrip('}').rstrip(');').rstrip('}').rstrip(');').rstrip()
    
    text = before + '\n\n' + after

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(text)
