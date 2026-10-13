import sys
import codecs

path = 'apps/web/src/app/[workspaceId]/publishing/[postId]/page.tsx'
with codecs.open(path, 'r', 'utf-8') as f:
    content = f.read()

content = content.replace(
    "variant.status === 'UNKNOWN' ? 'bg-gray-300 text-gray-800' :",
    "variant.status === 'UNKNOWN' ? 'bg-yellow-200 text-yellow-800' :"
)

content = content.replace(
    "{variant.status}",
    "{variant.status === 'UNKNOWN' ? 'Needs review (UNKNOWN)' : variant.status}"
)

old_onClick = """onClick={() => handleAction('reconcile', {
                    decision: reconcileOutcome,
                    reason: reconcileReason,
                    externalPostId: reconcileExternalId || undefined,
                    canonicalUrl: reconcileUrl || undefined,
                  })}"""

new_onClick = """onClick={() => {
                    const payload: Record<string, string> = {
                      decision: reconcileOutcome as string,
                      reason: reconcileReason.trim(),
                    };
                    if (reconcileOutcome === 'CONFIRM_PUBLISHED') {
                      payload.externalPostId = reconcileExternalId.trim();
                      if (reconcileUrl.trim()) {
                        payload.canonicalUrl = reconcileUrl.trim();
                      }
                    }
                    handleAction('reconcile', payload);
                  }}"""
                  
content = content.replace(old_onClick, new_onClick)

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(content)
print("Done patching.")
