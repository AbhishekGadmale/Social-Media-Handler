import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';

export const getQueryClient = () => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          // Don't retry auth errors or not found
          if (error instanceof ApiError) {
            if ([401, 403, 404].includes(error.status)) return false;
          }
          return failureCount < 3;
        },
        staleTime: 60 * 1000, // 1 minute
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false, // Don't automatically retry mutations
      },
    },
  });
};

// Global instance for browser
let browserQueryClient: QueryClient | undefined = undefined;

export const getClientQueryClient = () => {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return getQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    if (!browserQueryClient) browserQueryClient = getQueryClient();
    return browserQueryClient;
  }
};
