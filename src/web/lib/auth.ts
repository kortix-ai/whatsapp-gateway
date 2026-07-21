import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Session } from './types';

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api<Session>('/api/auth/get-session'),
    staleTime: 30_000,
    retry: false,
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api('/api/auth/sign-in/email', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
  });
}

export function useSignUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) =>
      api('/api/auth/sign-up/email', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/api/auth/sign-out', { method: 'POST', body: {} }),
    onSuccess: () => queryClient.clear(),
  });
}
