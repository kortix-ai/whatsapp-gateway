import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ApiKeySummary, CreatedApiKey, Paginated } from '@/lib/types';

export const apiKeyKeys = { all: ['api-keys'] as const };

export function useApiKeys() {
  return useQuery({
    queryKey: apiKeyKeys.all,
    queryFn: () => api<Paginated<ApiKeySummary>>('/v1/api-keys').then((r) => r.data),
  });
}

export type CreateApiKeyInput = {
  name: string;
  scope: 'connection' | 'account';
  account_id?: string;
  expires_in_seconds?: number | null;
  permissions?: Record<string, string[]>;
};

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) => api<CreatedApiKey>('/v1/api-keys', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeyKeys.all }),
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => api<void>(`/v1/api-keys/${keyId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeyKeys.all }),
  });
}
