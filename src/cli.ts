#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

/**
 * wag — the WhatsApp Gateway CLI.
 *
 * A thin, deterministic client over the gateway REST API. The command tree,
 * flags, and output conventions mirror a local-first WhatsApp CLI so the same
 * muscle memory works here, while every operation runs through the durable,
 * multi-account gateway instead of a local store.
 */

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;
type Row = Record<string, unknown>;

// Piping into `head`, `less`, or similar closes stdout early. Exit quietly
// instead of crashing with an unhandled EPIPE, the way standard tools behave.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
}

/* ------------------------------------------------------------------ parsing */

const argv = process.argv.slice(2);
const words: string[] = [];
const flags = new Map<string, string[] | true>();

for (let index = 0; index < argv.length; index += 1) {
  const token = argv[index]!;
  if (!token.startsWith('--')) {
    words.push(token);
    continue;
  }
  const [name, inline] = token.includes('=') ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)] : [token, undefined];
  const next = inline ?? (argv[index + 1] && !argv[index + 1]!.startsWith('--') ? argv[index + 1] : undefined);
  if (next === undefined) {
    flags.set(name, true);
    continue;
  }
  if (inline === undefined) index += 1;
  const existing = flags.get(name);
  if (Array.isArray(existing)) existing.push(next);
  else flags.set(name, [next]);
}

function str(name: string): string | undefined {
  const value = flags.get(`--${name}`);
  return Array.isArray(value) ? value[0] : undefined;
}
function list(name: string): string[] {
  const value = flags.get(`--${name}`);
  return Array.isArray(value) ? value : [];
}
function bool(name: string): boolean {
  return flags.has(`--${name}`);
}
function num(name: string): number | undefined {
  const value = str(name);
  return value === undefined ? undefined : Number(value);
}

/* ------------------------------------------------------------------- errors */

class UsageError extends Error {}
class BlockedError extends Error {}
class ResolveError extends Error {}

function required(value: string | undefined, message: string): string {
  if (!value) throw new UsageError(message);
  return value;
}

/* ------------------------------------------------------------------- config */

const baseUrl = (str('base-url') ?? process.env.WHATSAPP_GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const apiKey = str('api-key') ?? process.env.WHATSAPP_GATEWAY_API_KEY;
const asJson = bool('json');
const asEvents = bool('events');
const readOnly = bool('read-only') || process.env.WAG_READONLY === 'true';
const timeoutMs = (num('timeout') ?? 60) * 1000;
const idempotencyKey = str('idempotency-key');

/* ------------------------------------------------------------------ request */

async function request(path: string, init: RequestInit = {}): Promise<Json> {
  if (!apiKey) throw new UsageError('Set WHATSAPP_GATEWAY_API_KEY or pass --api-key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        ...init.headers,
      },
    });
    const text = await response.text();
    let payload: Json = null;
    if (text) {
      try { payload = JSON.parse(text) as Json; } catch { payload = text; }
    }
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function json(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

async function data<T = Row>(path: string): Promise<T[]> {
  const response = await request(path) as { data?: T[] };
  return response.data ?? [];
}

/* -------------------------------------------------------------------- output */

function print(value: Json): void {
  if (typeof value === 'string' && !asJson) process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, asJson ? 0 : 2)}\n`);
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

/** Render rows as an aligned table, or as `{data}` JSON when --json is set. */
function table(rows: Row[], columns: Array<{ key: string; header: string }>): void {
  if (asJson) { print({ data: rows } as Json); return; }
  if (rows.length === 0) { process.stdout.write('No results.\n'); return; }
  const widths = columns.map((column) =>
    Math.max(column.header.length, ...rows.map((row) => cell(row[column.key]).length)));
  const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index]!)).join('  ').trimEnd();
  process.stdout.write(`${line(columns.map((column) => column.header.toUpperCase()))}\n`);
  for (const row of rows) process.stdout.write(`${line(columns.map((column) => cell(row[column.key])))}\n`);
}

/** Render a single record as aligned key/value pairs, or JSON with --json. */
function record(value: Row): void {
  if (asJson) { print(value as Json); return; }
  const keys = Object.keys(value);
  if (keys.length === 0) { process.stdout.write('No fields.\n'); return; }
  const width = Math.max(...keys.map((key) => key.length));
  for (const key of keys) process.stdout.write(`${key.padEnd(width)}  ${cell(value[key])}\n`);
}

/* ------------------------------------------------------------------ account */

let cachedAccount: string | null = null;

/**
 * Resolve which connection to operate on: an explicit --account/WAG_ACCOUNT,
 * otherwise the only accessible connection (the common case for a
 * connection-scoped API key).
 */
async function account(): Promise<string> {
  if (cachedAccount) return cachedAccount;
  const explicit = str('account') ?? process.env.WAG_ACCOUNT;
  const accounts = await data<{ id: string; displayName: string }>('/v1/accounts');
  if (explicit) {
    const match = accounts.find((entry) => entry.id === explicit || entry.displayName === explicit);
    if (!match) throw new ResolveError(`No connection named "${explicit}". Run: wag accounts list`);
    cachedAccount = match.id;
    return match.id;
  }
  if (accounts.length === 1) { cachedAccount = accounts[0]!.id; return cachedAccount; }
  if (accounts.length === 0) throw new ResolveError('No connections are accessible with this key.');
  const names = accounts.map((entry) => `  ${entry.id}  ${entry.displayName}`).join('\n');
  throw new ResolveError(`Multiple connections are accessible. Pass --account.\n${names}`);
}

/* ---------------------------------------------------------------- recipients */

function isJid(value: string): boolean {
  return value.includes('@');
}

function phoneJid(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return /^\+?[\d\s()\-.]+$/.test(value) && digits.length >= 7 ? `${digits}@s.whatsapp.net` : null;
}

/**
 * Accept a JID, an E.164/formatted phone number, or the name of a synced
 * contact, group, or chat. Ambiguous names require --pick N.
 */
async function recipient(value: string): Promise<string> {
  if (isJid(value)) return value;
  const phone = phoneJid(value);
  if (phone) return phone;

  const accountId = await account();
  const query = encodeURIComponent(value);
  const [contacts, groups, chats] = await Promise.all([
    data<{ jid: string; name?: string | null; notify?: string | null }>(`/v1/accounts/${accountId}/contacts?q=${query}`),
    data<{ jid: string; subject?: string | null }>(`/v1/accounts/${accountId}/groups?q=${query}`),
    data<{ jid: string; name?: string | null }>(`/v1/accounts/${accountId}/chats?q=${query}`),
  ]);
  const candidates = [
    ...groups.map((entry) => ({ jid: entry.jid, label: entry.subject ?? entry.jid, kind: 'group' })),
    ...contacts.map((entry) => ({ jid: entry.jid, label: entry.name ?? entry.notify ?? entry.jid, kind: 'contact' })),
    ...chats.map((entry) => ({ jid: entry.jid, label: entry.name ?? entry.jid, kind: 'chat' })),
  ].filter((entry, index, all) => all.findIndex((other) => other.jid === entry.jid) === index);

  if (candidates.length === 0) throw new ResolveError(`No contact, group, or chat matches "${value}".`);
  const pick = num('pick');
  if (candidates.length === 1) return candidates[0]!.jid;
  if (pick !== undefined && candidates[pick]) return candidates[pick]!.jid;
  const options = candidates.map((entry, index) => `  [${index}] ${entry.kind.padEnd(7)} ${entry.label}  ${entry.jid}`).join('\n');
  throw new ResolveError(`"${value}" is ambiguous. Re-run with --pick N.\n${options}`);
}

/* ------------------------------------------------------------------ commands */

const MUTATIONS = new Set(['send', 'chats', 'groups', 'presence', 'profile', 'channels', 'auth', 'accounts']);
const READ_SUBCOMMANDS = new Set(['list', 'status', 'get', 'search', 'media', 'info', 'coverage']);

function guardReadOnly(domain: string, action: string): void {
  if (!readOnly) return;
  if (!MUTATIONS.has(domain)) return;
  if (READ_SUBCOMMANDS.has(action)) return;
  throw new BlockedError(`--read-only blocks "${domain} ${action}".`);
}

async function runAction(accountId: string, action: string, args: unknown[]): Promise<Json> {
  return request(`/v1/accounts/${accountId}/actions/${encodeURIComponent(action)}`, json({ args }));
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.wav': 'audio/wav', '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip',
  '.json': 'application/json',
};

const HELP = `wag — WhatsApp Gateway CLI

Global
  --account NAME     connection id or name (env WAG_ACCOUNT; optional when only one)
  --json             structured JSON output      --events   NDJSON stream
  --read-only        block every mutation        --pick N   disambiguate a recipient
  --timeout SECONDS  --base-url URL  --api-key KEY  --idempotency-key KEY

auth        status | qr [--output FILE] | code --phone E164 | logout
accounts    list | add --name NAME [--phone E164] | status
send        text --to R --message TEXT [--reply MSG_ID] [--mention PHONE]...
            file --to R --file PATH [--caption TEXT] [--kind KIND] [--voice]
            reaction --message MSG_ID --emoji 👍
            location --to R --lat LAT --lng LNG [--name NAME]
messages    list [--chat R] [--unread] [--direction D] [--type T] [--limit N]
            search QUERY [--chat R] [--limit N]
            read --message MSG_ID
            media --message MSG_ID [--output PATH]
chats       list [--unread] [--archived] [--search TEXT]
            archive R | unarchive R | pin R | unpin R | mute R [--hours N] | unmute R
            mark-read R | mark-unread R
contacts    list [--search TEXT]
groups      list [--search TEXT] | create --subject NAME --participant P...
            participants G --add P... | --remove P... | --promote P... | --demote P...
presence    set --state available|unavailable|composing|recording|paused [--to R]
profile     set-name NAME | set-status TEXT
channels    send --to R --message TEXT
events      tail [--type TYPE] [--once] [--after-sequence N]
commands    get ID [--wait]
actions     list [--category NAME] | run ACTION --args '<json-array>'
webhooks    list
doctor      version      help
`;

async function main(): Promise<void> {
  const [domain, action, ...rest] = words;
  if (!domain || domain === 'help' || bool('help')) { process.stdout.write(HELP); return; }

  if (domain === 'version') { print({ cli: 'wag', base_url: baseUrl }); return; }

  if (domain === 'completion') {
    process.stdout.write(`# add to your shell profile\ncomplete -W "auth accounts send messages chats contacts groups presence profile channels events commands actions webhooks doctor version help" wag\n`);
    return;
  }

  if (domain === 'doctor') {
    const health = await fetch(`${baseUrl}/health`).then((r) => r.ok).catch(() => false);
    const ready = await fetch(`${baseUrl}/health/ready`).then((r) => r.ok).catch(() => false);
    let accounts = 0;
    let authed = false;
    try { accounts = (await data('/v1/accounts')).length; authed = true; } catch { authed = false; }
    record({ base_url: baseUrl, health, ready, authenticated: authed, accessible_connections: accounts, read_only: readOnly });
    if (!health || !ready || !authed) process.exitCode = 1;
    return;
  }

  guardReadOnly(domain, action ?? '');

  /* ---- auth ---- */
  if (domain === 'auth') {
    if (action === 'status') {
      const accounts = await data<Row>('/v1/accounts');
      record({ base_url: baseUrl, authenticated: true, accessible_connections: accounts.length, read_only: readOnly });
      return;
    }
    if (action === 'qr') {
      const accountId = await account();
      let result: Row = {};
      for (let attempt = 0; attempt < 3; attempt += 1) {
        result = await request(`/v1/accounts/${accountId}/pair/qr`, json({})) as Row;
        if (typeof result.qr_data_url === 'string' || result.status === 'connected') break;
        await new Promise((done) => setTimeout(done, 1000));
      }
      const dataUrl = typeof result.qr_data_url === 'string' ? result.qr_data_url : null;
      if (!dataUrl) { record(result); return; }
      const output = resolve(str('output') ?? `whatsapp-pairing-${accountId}.png`);
      await writeFile(output, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
      record({ account_id: accountId, status: result.status, qr_file: output });
      return;
    }
    if (action === 'code') {
      const accountId = await account();
      record(await request(`/v1/accounts/${accountId}/pair/code`, json({ phone_number: required(str('phone'), '--phone is required') })) as Row);
      return;
    }
    if (action === 'logout') {
      const accountId = await account();
      record(await request(`/v1/accounts/${accountId}/session`, { method: 'DELETE' }) as Row);
      return;
    }
  }

  /* ---- accounts ---- */
  if (domain === 'accounts') {
    if (action === 'list') {
      table(await data<Row>('/v1/accounts'), [
        { key: 'id', header: 'id' }, { key: 'displayName', header: 'name' },
        { key: 'phoneNumber', header: 'phone' }, { key: 'status', header: 'status' },
      ]);
      return;
    }
    if (action === 'add') {
      const name = required(str('name'), '--name is required');
      const phone = str('phone');
      record(await request('/v1/accounts', json({ display_name: name, ...(phone ? { phone_number: phone } : {}) })) as Row);
      return;
    }
    if (action === 'status') {
      record(await request(`/v1/accounts/${await account()}/status`) as Row);
      return;
    }
  }

  /* ---- send ---- */
  if (domain === 'send') {
    const accountId = await account();
    if (action === 'text') {
      const to = await recipient(required(str('to'), '--to is required'));
      const message = required(str('message'), '--message is required');
      const mentions = await Promise.all(list('mention').map((entry) => recipient(entry)));
      const replyTo = str('reply');
      const content: Row = { text: message, ...(mentions.length ? { mentions } : {}) };
      if (replyTo) {
        const messages = await data<{ id: string; whatsappMessageId?: string; payload?: unknown }>(`/v1/accounts/${accountId}/messages?limit=200`);
        const quoted = messages.find((entry) => entry.id === replyTo || entry.whatsappMessageId === replyTo);
        if (!quoted?.payload) throw new ResolveError('Reply target was not found in the recent messages.');
        record(await runAction(accountId, 'messages.send', [to, content, { quoted: quoted.payload }]) as Row);
        return;
      }
      record(await request(`/v1/accounts/${accountId}/messages`, json({ to, content })) as Row);
      return;
    }
    if (action === 'file') {
      const to = await recipient(required(str('to'), '--to is required'));
      const path = resolve(required(str('file'), '--file is required'));
      const bytes = await readFile(path);
      const mimetype = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
      const form = new FormData();
      form.append('to', to);
      form.append('file', new File([new Uint8Array(bytes)], basename(path), { type: mimetype }));
      const caption = str('caption');
      if (caption) form.append('caption', caption);
      const kind = str('kind');
      if (kind) form.append('kind', kind);
      if (bool('voice')) form.append('voice', 'true');
      record(await request(`/v1/accounts/${accountId}/messages/media`, { method: 'POST', body: form }) as Row);
      return;
    }
    if (action === 'reaction') {
      const messageId = required(str('message'), '--message is required');
      const emoji = required(str('emoji'), '--emoji is required');
      record(await request(`/v1/accounts/${accountId}/messages/${encodeURIComponent(messageId)}/reaction`, json({ emoji })) as Row);
      return;
    }
    if (action === 'location') {
      const to = await recipient(required(str('to'), '--to is required'));
      const latitude = Number(required(str('lat'), '--lat is required'));
      const longitude = Number(required(str('lng'), '--lng is required'));
      const name = str('name');
      const location: Row = { degreesLatitude: latitude, degreesLongitude: longitude, ...(name ? { name } : {}) };
      record(await request(`/v1/accounts/${accountId}/messages`, json({ to, content: { location } })) as Row);
      return;
    }
  }

  /* ---- messages ---- */
  if (domain === 'messages') {
    const accountId = await account();
    const columns = [
      { key: 'id', header: 'id' }, { key: 'direction', header: 'dir' },
      { key: 'messageType', header: 'type' }, { key: 'text', header: 'text' },
      { key: 'messageTimestamp', header: 'when' },
    ];
    if (action === 'list' || action === 'search') {
      const params = new URLSearchParams({ limit: String(num('limit') ?? 50) });
      const query = action === 'search' ? rest[0] : undefined;
      if (action === 'search') params.set('q', required(query, 'A search query is required'));
      const chat = str('chat');
      if (chat) params.set('chat_jid', await recipient(chat));
      if (bool('unread')) params.set('unread', 'true');
      if (str('direction')) params.set('direction', str('direction')!);
      if (str('type')) params.set('type', str('type')!);
      if (str('sender')) params.set('sender_jid', await recipient(str('sender')!));
      table(await data<Row>(`/v1/accounts/${accountId}/messages?${params}`), columns);
      return;
    }
    if (action === 'read') {
      const messageId = required(str('message'), '--message is required');
      record(await request(`/v1/accounts/${accountId}/messages/${encodeURIComponent(messageId)}/read`, json({})) as Row);
      return;
    }
    if (action === 'media') {
      const messageId = required(str('message'), '--message is required');
      if (!apiKey) throw new UsageError('Set WHATSAPP_GATEWAY_API_KEY or pass --api-key');
      const response = await fetch(`${baseUrl}/v1/accounts/${accountId}/messages/${encodeURIComponent(messageId)}/media?download=1`, {
        headers: { 'x-api-key': apiKey },
      });
      if (!response.ok) throw new Error(`Media download failed (${response.status})`);
      const disposition = response.headers.get('content-disposition') ?? '';
      const suggested = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${messageId}.bin`;
      const output = resolve(str('output') ?? suggested);
      await writeFile(output, Buffer.from(await response.arrayBuffer()));
      record({ message_id: messageId, file: output, content_type: response.headers.get('content-type') });
      return;
    }
  }

  /* ---- chats ---- */
  if (domain === 'chats') {
    const accountId = await account();
    if (action === 'list') {
      const params = new URLSearchParams();
      if (bool('unread')) params.set('unread', 'true');
      if (bool('archived')) params.set('archived', 'true');
      if (str('search')) params.set('q', str('search')!);
      table(await data<Row>(`/v1/accounts/${accountId}/chats?${params}`), [
        { key: 'jid', header: 'jid' }, { key: 'name', header: 'name' },
        { key: 'unreadCount', header: 'unread' }, { key: 'archived', header: 'archived' },
      ]);
      return;
    }
    const STATE: Record<string, Row> = {
      archive: { archived: true }, unarchive: { archived: false },
      pin: { pinned: true }, unpin: { pinned: false },
      mute: { muted: true }, unmute: { muted: false },
      'mark-read': { read: true }, 'mark-unread': { read: false },
    };
    const patch = action ? STATE[action] : undefined;
    if (patch) {
      const jid = await recipient(required(rest[0], 'A chat, contact, or group is required'));
      const hours = num('hours');
      const payload = action === 'mute' && hours ? { ...patch, mute_seconds: hours * 3600 } : patch;
      record(await request(`/v1/accounts/${accountId}/chats/${encodeURIComponent(jid)}`, {
        method: 'PATCH', body: JSON.stringify(payload),
      }) as Row);
      return;
    }
  }

  /* ---- contacts ---- */
  if (domain === 'contacts' && action === 'list') {
    const params = str('search') ? `?q=${encodeURIComponent(str('search')!)}` : '';
    table(await data<Row>(`/v1/accounts/${await account()}/contacts${params}`), [
      { key: 'jid', header: 'jid' }, { key: 'name', header: 'name' },
      { key: 'notify', header: 'notify' }, { key: 'phoneNumber', header: 'phone' },
    ]);
    return;
  }

  /* ---- groups ---- */
  if (domain === 'groups') {
    const accountId = await account();
    if (action === 'list') {
      const params = str('search') ? `?q=${encodeURIComponent(str('search')!)}` : '';
      table(await data<Row>(`/v1/accounts/${accountId}/groups${params}`), [
        { key: 'jid', header: 'jid' }, { key: 'subject', header: 'subject' }, { key: 'ownerJid', header: 'owner' },
      ]);
      return;
    }
    if (action === 'create') {
      const participants = await Promise.all(list('participant').map((entry) => recipient(entry)));
      if (!participants.length) throw new UsageError('At least one --participant is required');
      record(await request(`/v1/accounts/${accountId}/groups`, json({
        subject: required(str('subject'), '--subject is required'), participants,
      })) as Row);
      return;
    }
    if (action === 'participants') {
      const group = await recipient(required(rest[0], 'A group is required'));
      const modes = [['add', 'add'], ['remove', 'remove'], ['promote', 'promote'], ['demote', 'demote']] as const;
      for (const [flag, mode] of modes) {
        const entries = list(flag);
        if (!entries.length) continue;
        const participants = await Promise.all(entries.map((entry) => recipient(entry)));
        record(await request(`/v1/accounts/${accountId}/groups/${encodeURIComponent(group)}/participants`, json({ participants, action: mode })) as Row);
        return;
      }
      throw new UsageError('Pass one of --add, --remove, --promote, or --demote');
    }
  }

  /* ---- presence / profile / channels ---- */
  if (domain === 'presence' && action === 'set') {
    const accountId = await account();
    const to = str('to');
    record(await request(`/v1/accounts/${accountId}/presence`, json({
      state: required(str('state'), '--state is required'),
      ...(to ? { to: await recipient(to) } : {}),
    })) as Row);
    return;
  }

  if (domain === 'profile') {
    const accountId = await account();
    if (action === 'set-name') { record(await runAction(accountId, 'profile.name.update', [required(rest[0], 'A name is required')]) as Row); return; }
    if (action === 'set-status') { record(await runAction(accountId, 'profile.status.update', [required(rest[0], 'A status is required')]) as Row); return; }
  }

  if (domain === 'channels' && action === 'send') {
    const accountId = await account();
    record(await request(`/v1/accounts/${accountId}/messages`, json({
      to: required(str('to'), '--to is required'),
      text: required(str('message'), '--message is required'),
    })) as Row);
    return;
  }

  /* ---- events / commands / actions / webhooks ---- */
  if (domain === 'events' && action === 'tail') {
    const accountId = await account();
    let cursor = str('after-sequence') ?? '0';
    for (;;) {
      const params = new URLSearchParams({ account_id: accountId, after_sequence: cursor, limit: '100' });
      if (str('type')) params.set('type', str('type')!);
      const response = await request(`/v1/events?${params}`) as { data?: Json[]; next_after_sequence?: string };
      for (const event of response.data ?? []) process.stdout.write(`${JSON.stringify(event)}\n`);
      cursor = response.next_after_sequence ?? cursor;
      if (bool('once')) return;
      await new Promise((done) => setTimeout(done, 1000));
    }
  }

  if (domain === 'commands' && action === 'get') {
    const commandId = required(rest[0], 'A command id is required');
    if (!bool('wait')) { record(await request(`/v1/commands/${encodeURIComponent(commandId)}`) as Row); return; }
    for (;;) {
      const command = await request(`/v1/commands/${encodeURIComponent(commandId)}?wait_seconds=30`) as Row;
      if (command.status === 'completed' || command.status === 'failed') { record(command); return; }
    }
  }

  if (domain === 'actions') {
    if (action === 'list') {
      const all = await data<{ name: string; method: string; description: string }>('/v1/baileys-actions');
      const category = str('category');
      const rows = category ? all.filter((entry) => entry.name.startsWith(`${category}.`)) : all;
      table(rows as unknown as Row[], [
        { key: 'name', header: 'action' }, { key: 'method', header: 'method' }, { key: 'description', header: 'description' },
      ]);
      return;
    }
    if (action === 'run') {
      const name = required(rest[0], 'An action name is required');
      const parsed = JSON.parse(str('args') ?? '[]') as unknown;
      if (!Array.isArray(parsed)) throw new UsageError('--args must be a JSON array');
      record(await runAction(await account(), name, parsed) as Row);
      return;
    }
  }

  if (domain === 'webhooks' && action === 'list') {
    table(await data<Row>('/v1/webhook-endpoints'), [
      { key: 'id', header: 'id' }, { key: 'url', header: 'url' },
      { key: 'enabled', header: 'enabled' }, { key: 'description', header: 'description' },
    ]);
    return;
  }

  throw new UsageError(`Unknown command: ${[domain, action].filter(Boolean).join(' ')}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`wag: ${message}\n`);
  if (error instanceof UsageError) { process.stderr.write(`\n${HELP}`); process.exitCode = 2; }
  else if (error instanceof BlockedError) process.exitCode = 3;
  else if (error instanceof ResolveError) process.exitCode = 4;
  else process.exitCode = 1;
});

// `--events` currently applies to `events tail`, which always streams NDJSON.
void asEvents;
