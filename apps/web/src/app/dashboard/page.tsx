'use client';

import { useQuery } from '@tanstack/react-query';
import { authQueries } from '../../lib/query/auth';
import { api } from '../../lib/api/client';
import { useRouter } from 'next/navigation';

export default function Dashboard() {
  const { data: authData } = useQuery(authQueries.me());
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await api.post('auth/logout');
      router.push('/login');
    } catch (e) {
      console.error('Logout failed', e);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <button 
            onClick={handleLogout}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
        
        <div className="space-y-4">
          <p className="text-gray-600">
            Welcome back, <span className="font-semibold text-gray-900">{authData?.user.name}</span>
          </p>
          
          {authData?.memberships?.length ? (
            <div className="mt-8 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Your Workspaces</h2>
              {authData.memberships.map((membership) => (
                <div key={membership.id} className="p-4 border rounded-md hover:bg-gray-50 flex justify-between items-center">
                  <div>
                    <h3 className="font-medium text-gray-900">{membership.workspace.name}</h3>
                    <p className="text-sm text-gray-500">Role: {membership.role}</p>
                  </div>
                  <button 
                    onClick={() => router.push(`/${membership.workspaceId}/accounts`)}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                  >
                    Enter Workspace
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-8 p-4 bg-yellow-50 text-yellow-700 rounded-md">
              You do not currently have any workspaces.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
