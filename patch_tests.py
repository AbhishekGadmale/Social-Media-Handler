import codecs

path = 'apps/web/src/app/[workspaceId]/publishing/[postId]/page.spec.tsx'
with codecs.open(path, 'r', 'utf-8') as f:
    content = f.read()

content = content.replace("getByLabelText(/External Post ID/i)", "getByText('External Post ID *').nextSibling as HTMLInputElement")
content = content.replace("getByLabelText(/Canonical URL/i)", "getByText('Canonical URL (Optional)').nextSibling as HTMLInputElement")

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(content)
print("Done patching tests.")
