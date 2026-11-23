import { Suspense } from 'react';
import DiscoveryClientPage from './discovery-client';

export default async function DiscoveryPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return (
    <Suspense fallback={<div className='p-8 text-center text-gray-500'>Loading...</div>}>
      <DiscoveryClientPage workspaceId={workspaceId} />
    </Suspense>
  );
}

