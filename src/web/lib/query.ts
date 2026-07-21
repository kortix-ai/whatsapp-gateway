import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Never retry auth/permission/not-found — they are deterministic.
        if (error instanceof ApiError && [401, 403, 404, 409].includes(error.status)) return false;
        return failureCount < 2;
      },
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});
