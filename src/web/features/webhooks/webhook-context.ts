import { useOutletContext } from 'react-router-dom';
import type { WebhookEndpoint } from '@/lib/types';

export type WebhookContext = { endpoint: WebhookEndpoint };

export function useWebhookContext() {
  return useOutletContext<WebhookContext>();
}
