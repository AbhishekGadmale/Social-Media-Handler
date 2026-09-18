import { Suspense } from 'react';
import DiscoveryClientPage from './discovery-client';

export default function DiscoveryPage({ params }: { params: { workspaceId: string } }) {
  return (
    <Suspense fallback={<div className='p-8 text-center text-gray-500'>Loading...</div>}>
      <DiscoveryClientPage workspaceId={params.workspaceId} />
    </Suspense>
  );
}

