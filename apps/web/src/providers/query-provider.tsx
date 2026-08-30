'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { getClientQueryClient } from '../lib/query/client';
import { ReactNode } from 'react';

export function QueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getClientQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
