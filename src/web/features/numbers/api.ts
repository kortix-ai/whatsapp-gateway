import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Account, AccountStatus, CommandEnvelope, PairQrResponse, Paginated } from '@/lib/types';

export const accountKeys = {
  all: ['accounts'] as const,
  status: (id: string) => ['accounts', id, 'status'] as const,
};

export function useAccounts() {
  return useQuery({
    queryKey: accountKeys.all,
    queryFn: () => api<Paginated<Account>>('/v1/accounts').then((r) => r.data),
  });
}

export function useAccount(accountId: string | undefined) {
  const accounts = useAccounts();
  return {
    ...accounts,
    data: accounts.data?.find((account) => account.id === accountId),
  };
}

/** Live connection status. Polls quickly while pairing/connecting, calmly otherwise. */
export function useAccountStatus(accountId: string | undefined, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: accountId ? accountKeys.status(accountId) : ['accounts', 'none', 'status'],
    queryFn: () => api<AccountStatus>(`/v1/accounts/${accountId}/status`),
    enabled: Boolean(accountId),
    refetchInterval: (query) => {
      if (options?.poll === false) return false;
      const status = query.state.data?.status;
      if (status === 'connecting' || status === 'reconnecting' || status === 'pairing') return 2000;
      return 8000;
    },
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { display_name: string; phone_number?: string }) =>
      api<Account>('/v1/accounts', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

export function usePairQr(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<PairQrResponse>(`/v1/accounts/${accountId}/pair/qr`, { method: 'POST', body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.status(accountId) }),
  });
}

export function usePairCode(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { phone_number: string }) =>
      api<CommandEnvelope>(`/v1/accounts/${accountId}/pair/code`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.status(accountId) }),
  });
}

export function useLogoutSession(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<CommandEnvelope>(`/v1/accounts/${accountId}/session`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountKeys.status(accountId) });
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
    },
  });
}
