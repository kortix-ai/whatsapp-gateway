import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Chat, CommandEnvelope, Contact, Group, Message, Paginated } from '@/lib/types';

function queryString(params: Record<string, string | boolean | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) search.set(key, String(value));
  }
  const string = search.toString();
  return string ? `?${string}` : '';
}

export function useChats(accountId: string, filters: { q?: string; unread?: boolean; archived?: string }) {
  return useQuery({
    queryKey: ['accounts', accountId, 'chats', filters],
    queryFn: () =>
      api<Paginated<Chat>>(
        `/v1/accounts/${accountId}/chats${queryString({ q: filters.q, unread: filters.unread, archived: filters.archived })}`,
      ).then((r) => r.data),
  });
}

export function useContacts(accountId: string, filters: { q?: string }) {
  return useQuery({
    queryKey: ['accounts', accountId, 'contacts', filters],
    queryFn: () =>
      api<Paginated<Contact>>(`/v1/accounts/${accountId}/contacts${queryString({ q: filters.q })}`).then((r) => r.data),
  });
}

export function useGroups(accountId: string, filters: { q?: string }) {
  return useQuery({
    queryKey: ['accounts', accountId, 'groups', filters],
    queryFn: () =>
      api<Paginated<Group>>(`/v1/accounts/${accountId}/groups${queryString({ q: filters.q })}`).then((r) => r.data),
  });
}

export type MessageFilters = {
  chat_jid?: string;
  unread?: boolean;
  direction?: string;
  type?: string;
  limit?: number;
};

export function useMessages(accountId: string, filters: MessageFilters) {
  return useQuery({
    queryKey: ['accounts', accountId, 'messages', filters],
    queryFn: () =>
      api<Paginated<Message>>(
        `/v1/accounts/${accountId}/messages${queryString({
          chat_jid: filters.chat_jid,
          unread: filters.unread,
          direction: filters.direction,
          type: filters.type,
          limit: filters.limit ?? 50,
        })}`,
      ).then((r) => r.data),
  });
}

export function useSendMessage(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { to: string; text: string }) =>
      api<CommandEnvelope>(`/v1/accounts/${accountId}/messages`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts', accountId, 'messages'] }),
  });
}

export function useCreateGroup(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { subject: string; participants: string[] }) =>
      api<CommandEnvelope>(`/v1/accounts/${accountId}/groups`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts', accountId, 'groups'] }),
  });
}

export function useUpdateGroup(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, ...input }: { groupId: string; subject?: string; description?: string }) =>
      api<CommandEnvelope>(`/v1/accounts/${accountId}/groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts', accountId, 'groups'] }),
  });
}

export function useGroupParticipants(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      participants,
      action,
    }: {
      groupId: string;
      participants: string[];
      action: 'add' | 'remove' | 'promote' | 'demote';
    }) =>
      api<CommandEnvelope>(`/v1/accounts/${accountId}/groups/${encodeURIComponent(groupId)}/participants`, {
        method: 'POST',
        body: { participants, action },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts', accountId, 'groups'] }),
  });
}
