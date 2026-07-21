#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

const raw = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = raw.indexOf(name);
  return index >= 0 ? raw[index + 1] : undefined;
}

function options(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < raw.length; index += 1) if (raw[index] === name && raw[index + 1]) values.push(raw[index + 1]!);
  return values;
}

function flag(name: string): boolean { return raw.includes(name); }

const globalWithValue = new Set(['--base-url', '--api-key']);
const positional: string[] = [];
for (let index = 0; index < raw.length; index += 1) {
  const value = raw[index]!;
  if (globalWithValue.has(value)) { index += 1; continue; }
  if (value === '--json') continue;
  positional.push(value);
}

const baseUrl = (option('--base-url') ?? process.env.WHATSAPP_GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const apiKey = option('--api-key') ?? process.env.WHATSAPP_GATEWAY_API_KEY;
const jsonOutput = flag('--json');

function requireValue(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function normalizeJid(value: string): string {
  if (value.includes('@')) return value;
  const digits = value.replace(/\D/g, '');
  if (!digits) throw new Error('A phone number or WhatsApp JID is required');
  return `${digits}@s.whatsapp.net`;
}

async function request(path: string, init?: RequestInit): Promise<Json> {
  if (!apiKey) throw new Error('Set WHATSAPP_GATEWAY_API_KEY or pass --api-key');
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'x-api-key': apiKey,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  let payload: Json = null;
  if (text) {
    try { payload = JSON.parse(text) as Json; } catch { payload = text; }
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload ? String(payload.message) : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload;
}

function print(value: Json): void {
  if (typeof value === 'string' && !jsonOutput) process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, jsonOutput ? 0 : 2)}\n`);
}

async function runAction(accountId: string, action: string, args: unknown[], idempotency?: string): Promise<Json> {
  return request(`/v1/accounts/${encodeURIComponent(accountId)}/actions/${encodeURIComponent(action)}`, {
    method: 'POST',
    ...(idempotency ? { headers: { 'Idempotency-Key': idempotency } } : {}),
    body: JSON.stringify({ args }),
  });
}

async function waitForCommand(commandId: string): Promise<Json> {
  while (true) {
    const command = await request(`/v1/commands/${encodeURIComponent(commandId)}?wait_seconds=30`) as Record<string, unknown>;
    if (command.status === 'completed' || command.status === 'failed') return command;
  }
}

const help = `wag — managed WhatsApp Gateway CLI

Global: --base-url URL --api-key KEY --json

wag auth status
wag accounts list
wag accounts status <account>
wag pair qr <account> [--output qr.png]
wag pair code <account> --phone <e164>
wag chats list <account> [--unread] [--search text]
wag messages list <account> [--chat jid] [--unread] [--limit n]
wag messages send <account> --to <phone-or-jid> --text <text> [--idempotency-key key]
wag messages read <account> --message <gateway-message-id>
wag groups list <account> [--search text]
wag groups create <account> --subject <name> --participant <phone-or-jid>...
wag actions list [--category privacy]
wag actions run <account> <action> --args '<json-array>' [--idempotency-key key]
wag commands get <command-id> [--wait]
wag events tail <account> [--type message.created] [--once]
wag webhooks list
`;

async function main(): Promise<void> {
  const [domain, action, first, second] = positional;
  if (!domain || domain === 'help' || flag('--help')) { process.stdout.write(help); return; }

  if (domain === 'auth' && action === 'status') {
    const accounts = await request('/v1/accounts') as { data?: unknown[] };
    print({ authenticated: true, base_url: baseUrl, accessible_accounts: accounts.data?.length ?? 0 });
    return;
  }
  if (domain === 'accounts' && action === 'list') { print(await request('/v1/accounts')); return; }
  if (domain === 'accounts' && action === 'status') { print(await request(`/v1/accounts/${encodeURIComponent(requireValue(first, 'account is required'))}/status`)); return; }
  if (domain === 'pair' && action === 'qr') {
    const account = requireValue(first, 'account is required');
    let result: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await request(`/v1/accounts/${encodeURIComponent(account)}/pair/qr`, { method: 'POST', body: '{}' }) as Record<string, unknown>;
      if (typeof result.qr_data_url === 'string' || result.status === 'connected') break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
    const dataUrl = typeof result.qr_data_url === 'string' ? result.qr_data_url : null;
    if (dataUrl) {
      const output = resolve(option('--output') ?? `whatsapp-pairing-${account}.png`);
      await writeFile(output, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
      print({ account_id: account, status: result.status, qr_file: output, expires_in_seconds: 300 });
    } else print(result);
    return;
  }
  if (domain === 'pair' && action === 'code') {
    const account = requireValue(first, 'account is required');
    print(await request(`/v1/accounts/${encodeURIComponent(account)}/pair/code`, {
      method: 'POST', body: JSON.stringify({ phone_number: requireValue(option('--phone'), '--phone is required') }),
    }));
    return;
  }
  if (domain === 'chats' && action === 'list') {
    const params = new URLSearchParams();
    if (flag('--unread')) params.set('unread', 'true');
    if (option('--search')) params.set('q', option('--search')!);
    print(await request(`/v1/accounts/${encodeURIComponent(requireValue(first, 'account is required'))}/chats?${params}`));
    return;
  }
  if (domain === 'messages' && action === 'list') {
    const params = new URLSearchParams({ limit: option('--limit') ?? '50' });
    if (option('--chat')) params.set('chat_jid', option('--chat')!);
    if (flag('--unread')) params.set('unread', 'true');
    print(await request(`/v1/accounts/${encodeURIComponent(requireValue(first, 'account is required'))}/messages?${params}`));
    return;
  }
  if (domain === 'messages' && action === 'send') {
    const result = await runAction(requireValue(first, 'account is required'), 'messages.send', [
      normalizeJid(requireValue(option('--to'), '--to is required')),
      { text: requireValue(option('--text'), '--text is required') },
    ], option('--idempotency-key'));
    print(result);
    return;
  }
  if (domain === 'messages' && action === 'read') {
    const account = requireValue(first, 'account is required');
    const wanted = requireValue(option('--message'), '--message is required');
    const messages = await request(`/v1/accounts/${encodeURIComponent(account)}/messages?limit=200`) as { data?: Array<{ id: string; whatsappMessageId?: string; payload?: { key?: unknown } }> };
    const message = messages.data?.find((entry) => entry.id === wanted || entry.whatsappMessageId === wanted);
    if (!message?.payload?.key) throw new Error('Message was not found in the latest 200 synchronized messages');
    print(await runAction(account, 'messages.read', [[message.payload.key]], option('--idempotency-key')));
    return;
  }
  if (domain === 'groups' && action === 'list') {
    const query = option('--search') ? `?q=${encodeURIComponent(option('--search')!)}` : '';
    print(await request(`/v1/accounts/${encodeURIComponent(requireValue(first, 'account is required'))}/groups${query}`));
    return;
  }
  if (domain === 'groups' && action === 'create') {
    const participants = options('--participant').map(normalizeJid);
    if (!participants.length) throw new Error('At least one --participant is required');
    print(await runAction(requireValue(first, 'account is required'), 'groups.create', [
      requireValue(option('--subject'), '--subject is required'), participants,
    ], option('--idempotency-key')));
    return;
  }
  if (domain === 'actions' && action === 'list') {
    const response = await request('/v1/baileys-actions') as { data?: Array<{ name: string }> };
    const category = option('--category');
    print(category ? { data: response.data?.filter((entry) => entry.name.startsWith(`${category}.`)) ?? [] } : response);
    return;
  }
  if (domain === 'actions' && action === 'run') {
    const args = JSON.parse(option('--args') ?? '[]') as unknown;
    if (!Array.isArray(args)) throw new Error('--args must be a JSON array');
    print(await runAction(requireValue(first, 'account is required'), requireValue(second, 'action is required'), args, option('--idempotency-key')));
    return;
  }
  if (domain === 'commands' && action === 'get') {
    const commandId = requireValue(first, 'command ID is required');
    print(flag('--wait') ? await waitForCommand(commandId) : await request(`/v1/commands/${encodeURIComponent(commandId)}`));
    return;
  }
  if (domain === 'events' && action === 'tail') {
    const account = requireValue(first, 'account is required');
    let cursor = option('--after-sequence') ?? '0';
    for (;;) {
      const params = new URLSearchParams({ account_id: account, after_sequence: cursor, limit: '100' });
      if (option('--type')) params.set('type', option('--type')!);
      const response = await request(`/v1/events?${params}`) as { data?: Json[]; next_after_sequence?: string };
      for (const event of response.data ?? []) process.stdout.write(`${JSON.stringify(event)}\n`);
      cursor = response.next_after_sequence ?? cursor;
      if (flag('--once')) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
  }
  if (domain === 'webhooks' && action === 'list') { print(await request('/v1/webhook-endpoints')); return; }
  throw new Error(`Unknown command.\n\n${help}`);
}

main().catch((error) => {
  process.stderr.write(`wag: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
