import type { ConnectionStatus } from './types';

export type StatusTone = 'success' | 'warning' | 'destructive' | 'muted';

type StatusMeta = { label: string; tone: StatusTone; description: string };

const STATUS: Record<string, StatusMeta> = {
  connected: { label: 'Connected', tone: 'success', description: 'The linked device is online and ready.' },
  connecting: { label: 'Connecting', tone: 'warning', description: 'Establishing the WhatsApp session.' },
  reconnecting: { label: 'Reconnecting', tone: 'warning', description: 'Recovering the WhatsApp session.' },
  pairing: { label: 'Pairing', tone: 'warning', description: 'Waiting for the device to be linked.' },
  disconnected: { label: 'Disconnected', tone: 'muted', description: 'No active WhatsApp session.' },
  logged_out: { label: 'Logged out', tone: 'muted', description: 'The linked device was removed.' },
  error: { label: 'Error', tone: 'destructive', description: 'The session failed and needs attention.' },
};

export function statusMeta(status: ConnectionStatus | null | undefined): StatusMeta {
  if (!status) return STATUS.disconnected!;
  return STATUS[status] ?? { label: String(status), tone: 'muted', description: '' };
}
