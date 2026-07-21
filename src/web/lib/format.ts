/** Human-friendly formatting helpers shared across the console. */

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelativeTime(value: string | number | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return '—';
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const table: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['week', 604_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, unitMs] of table) {
    if (abs >= unitMs) return relativeFormatter.format(Math.round(diff / unitMs), unit);
  }
  return relativeFormatter.format(Math.round(diff / 1000), 'second');
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isExpired(value: string | number | Date | null | undefined): boolean {
  if (!value) return false;
  const ms = (value instanceof Date ? value : new Date(value)).getTime();
  return !Number.isNaN(ms) && ms < Date.now();
}

export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '0:00';
  const total = Math.floor(msRemaining / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

/** Best-effort friendly rendering of a WhatsApp JID. */
export function friendlyJid(jid: string | null | undefined): string {
  if (!jid) return '';
  const [local] = jid.split('@');
  if (!local) return jid;
  if (jid.endsWith('@g.us')) return `Group ${local.slice(-6)}`;
  if (/^\d+$/.test(local)) return `+${local}`;
  return local;
}

export function initialsFrom(text: string | null | undefined): string {
  if (!text) return '?';
  const cleaned = text.replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (!cleaned) return text.slice(0, 2).toUpperCase();
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Turn `group.participants.updated` → `Group participants updated`. */
export function humanizeEventType(type: string): string {
  const words = type.replace(/[._]/g, ' ').split(' ');
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ');
}

export function eventCategory(type: string): string {
  return type.split('.')[0] ?? 'other';
}

export function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
