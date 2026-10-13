const fs = require('fs');
const path = 'apps/web/src/app/[workspaceId]/publishing/[postId]/page.spec.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/getByLabelText\(\/External Post ID\/i\)/g, "getByText('External Post ID *').nextSibling as HTMLInputElement");
content = content.replace(/getByLabelText\(\/Canonical URL\/i\)/g, "getByText('Canonical URL (Optional)').nextSibling as HTMLInputElement");

fs.writeFileSync(path, content, 'utf8');
console.log("Done patching tests.");
