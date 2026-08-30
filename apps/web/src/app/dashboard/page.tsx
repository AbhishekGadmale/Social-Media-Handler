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
          
          <div className="mt-8 p-4 bg-yellow-50 text-yellow-700 rounded-md">
            You do not currently have any workspaces.
          </div>
        </div>
      </div>
    </div>
  );
}
