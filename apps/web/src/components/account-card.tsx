import { ConnectedAccount } from '../lib/query/accounts';
import { AlertCircle, CheckCircle2, PlaySquare, HelpCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api/client';
import { Button } from './ui/button';

interface AccountCardProps {
  account: ConnectedAccount;
}

export function AccountCard({ account }: AccountCardProps) {
  const isYoutube = account.provider === 'YOUTUBE';
  const isActive = account.status === 'ACTIVE';
  const isReauthRequired = account.status === 'REAUTH_REQUIRED';
  
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReconnect = async () => {
    try {
      setIsReconnecting(true);
      setError(null);
      const res = await api.post<{ url: string }>(`workspaces/${account.workspaceId}/oauth/${account.provider.toLowerCase()}/connect`);
      if (res.url) {
        window.location.href = res.url;
      } else {
        throw new Error('No authorization URL returned');
      }
    } catch (err) {
      setError('Failed to initiate reconnection. Please try again.');
      setIsReconnecting(false);
    }
  };

  return (
    <div className="bg-white border rounded-lg shadow-sm p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-full flex-shrink-0 ${isYoutube ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
          {isYoutube ? <PlaySquare className="w-6 h-6" aria-hidden="true" /> : <HelpCircle className="w-6 h-6" aria-hidden="true" />}
        </div>
        
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{account.name}</h3>
          <div className="text-sm text-gray-500 capitalize">
            {account.provider.toLowerCase()}
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:items-end gap-3">
        <div className="flex items-center gap-2">
          {isActive ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700" title="Account is active and connected">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              Connected
            </span>
          ) : isReauthRequired ? (
            <div className="flex flex-col items-end gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-50 text-yellow-800" title="Account needs to be reconnected">
                <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                Reconnection Needed
              </span>
              <Button 
                onClick={handleReconnect} 
                disabled={isReconnecting}
                variant="outline"
                size="sm"
                className="h-8 text-xs font-medium border-yellow-200 text-yellow-700 hover:bg-yellow-50 hover:text-yellow-800"
              >
                {isReconnecting ? (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                ) : null}
                Reconnect {account.provider.toLowerCase()}
              </Button>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" aria-hidden="true" />
              {account.status}
            </span>
          )}
        </div>
        
        {account.capabilities && account.capabilities.length > 0 && (
          <div className="text-xs text-gray-500 flex gap-1.5 flex-wrap justify-end" aria-label="Account capabilities">
            {account.capabilities.map(cap => (
              <span key={cap} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                {cap.replace('_', ' ').toLowerCase()}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
