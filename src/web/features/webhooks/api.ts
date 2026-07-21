import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  CreatedWebhookEndpoint,
  Paginated,
  WebhookDelivery,
  WebhookEndpoint,
} from '@/lib/types';

export const webhookKeys = {
  endpoints: ['webhook-endpoints'] as const,
  endpoint: (id: string) => ['webhook-endpoints', id] as const,
  deliveries: (filters: unknown) => ['webhook-deliveries', filters] as const,
  eventTypes: ['webhook-event-types'] as const,
};

export function useWebhookEventTypes() {
  return useQuery({
    queryKey: webhookKeys.eventTypes,
    queryFn: () => api<Paginated<string>>('/v1/webhook-event-types').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function useWebhookEndpoints() {
  return useQuery({
    queryKey: webhookKeys.endpoints,
    queryFn: () => api<Paginated<WebhookEndpoint>>('/v1/webhook-endpoints').then((r) => r.data),
  });
}

export function useWebhookEndpoint(endpointId: string | undefined) {
  return useQuery({
    queryKey: endpointId ? webhookKeys.endpoint(endpointId) : ['webhook-endpoints', 'none'],
    queryFn: () => api<WebhookEndpoint>(`/v1/webhook-endpoints/${endpointId}`),
    enabled: Boolean(endpointId),
  });
}

export type CreateWebhookInput = {
  url: string;
  description?: string;
  event_types: string[];
  account_ids?: string[];
};

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebhookInput) =>
      api<CreatedWebhookEndpoint>('/v1/webhook-endpoints', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhookKeys.endpoints }),
  });
}

export function useUpdateWebhook(endpointId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<{ url: string; description: string | null; enabled: boolean; event_types: string[]; account_ids: string[] }>) =>
      api<WebhookEndpoint>(`/v1/webhook-endpoints/${endpointId}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.endpoints });
      queryClient.invalidateQueries({ queryKey: webhookKeys.endpoint(endpointId) });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (endpointId: string) => api<void>(`/v1/webhook-endpoints/${endpointId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: webhookKeys.endpoints }),
  });
}

export function useWebhookDeliveries(filters: { endpoint_id?: string; status?: string }) {
  return useQuery({
    queryKey: webhookKeys.deliveries(filters),
    queryFn: () => {
      const search = new URLSearchParams();
      if (filters.endpoint_id) search.set('endpoint_id', filters.endpoint_id);
      if (filters.status) search.set('status', filters.status);
      const qs = search.toString();
      return api<Paginated<WebhookDelivery>>(`/v1/webhook-deliveries${qs ? `?${qs}` : ''}`).then((r) => r.data);
    },
    refetchInterval: 10_000,
  });
}

export function useReplayDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) =>
      api<{ id: string; status: string }>(`/v1/webhook-deliveries/${deliveryId}/replay`, { method: 'POST', body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhook-deliveries'] }),
  });
}
