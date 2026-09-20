import codecs

path = 'packages/database/src/check-test-db.ts'
with codecs.open(path, 'r', 'utf-8') as f:
    text = f.read()

text = text.replace(
    "if (dbName !== 'agency_os_test') {",
    "if (dbName !== 'agency_os_test' && dbName !== 'agency_os_remote_execution_test') {"
)

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(text)
