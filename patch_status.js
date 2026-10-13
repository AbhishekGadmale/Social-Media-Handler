const fs = require('fs');
const path = 'apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
    ">\\n            Resolve status\\n          </Button>",
    ">\\n            Resolve publication\\n          </Button>"
);
content = content.replace(
    ">\\r\\n            Resolve status\\r\\n          </Button>",
    ">\\r\\n            Resolve publication\\r\\n          </Button>"
);
content = content.replace("Resolve status", "Resolve publication");
fs.writeFileSync(path, content, 'utf8');
console.log("Done.");
