// Shapes returned by the gateway REST API. Field casing intentionally mirrors
// the server: list/create/read of accounts and webhooks are camelCase Prisma
// rows, while the status and command envelopes are snake_case.

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'logged_out'
  | 'error'
  | string;

export type Account = {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  whatsappJid: string | null;
  status: ConnectionStatus;
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountStatus = {
  id: string;
  status: ConnectionStatus;
  phone_number: string | null;
  whatsapp_jid: string | null;
  pairing_mode: 'qr' | 'code' | null;
  pairing_expires_at: string | null;
  qr_data_url?: string | null;
  pairing_code?: string | null;
  last_connected_at: string | null;
  last_error: string | null;
};

export type PairQrResponse = {
  account_id: string;
  status: ConnectionStatus;
  qr_data_url?: string;
  status_url?: string;
};

export type CommandEnvelope = {
  command_id: string;
  account_id: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result: unknown;
  error: string | null;
  attempt_count: number;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ApiKeySummary = {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: boolean | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRequest: string | null;
  rateLimitMax: number | null;
  rateLimitTimeWindow: number | null;
  permissions: Record<string, string[]> | null;
  scope: 'connection' | 'account';
  account_id: string | null;
};

export type CreatedApiKey = {
  id: string;
  key: string;
  name: string | null;
  scope: 'connection' | 'account';
  account_id: string | null;
  expires_at: string | null;
  permissions: Record<string, string[]> | null;
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  description: string | null;
  enabled: boolean;
  eventTypes: string[];
  accountIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreatedWebhookEndpoint = WebhookEndpoint & { secret: string };

export type WebhookDelivery = {
  id: string;
  endpointId: string;
  status: 'pending' | 'delivering' | 'delivered' | 'retrying' | 'failed' | 'dead' | string;
  attemptCount: number;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  endpoint: { id: string; url: string; description: string | null };
  event: { id: string; type: string; accountId: string; occurredAt: string };
};

export type Chat = {
  accountId: string;
  jid: string;
  name: string | null;
  unreadCount: number;
  archived: boolean;
  updatedAt: string;
};

export type Contact = {
  accountId: string;
  jid: string;
  name: string | null;
  notify: string | null;
  phoneNumber: string | null;
  updatedAt: string;
};

export type Group = {
  accountId: string;
  jid: string;
  subject: string;
  ownerJid: string | null;
  participants: unknown[];
  updatedAt: string;
};

export type Message = {
  id: string;
  accountId: string;
  whatsappMessageId: string | null;
  chatJid: string;
  senderJid: string | null;
  direction: 'inbound' | 'outbound' | string;
  messageType: string;
  text: string | null;
  status: string;
  messageTimestamp: string;
  createdAt: string;
  payload?: unknown;
};

export type BaileysAction = {
  name: string;
  method: string;
  args: string;
  description: string;
  permission: { resource: string; action: string };
};

export type SessionUser = { id: string; name: string; email: string };
export type Session = { user: SessionUser } | null;

export type Paginated<T> = { data: T[]; next_before?: string | null; next_after_sequence?: string | null };
